import { Router } from "express";
import { z } from "zod";
import Papa from "papaparse";
import { validate } from "../middleware/validate";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth";
import { auditCtx } from "../middleware/auditCtx";
import {
  listInvestors,
  getInvestorById,
  createInvestor,
  updateInvestor,
  deleteInvestor,
  getInvestorByEmail,
  type InvestorInput,
} from "../services/investors";
import { listPositionsByInvestor } from "../services/deals";
import { listCommunicationsByInvestor } from "../services/communications";

const investorBody = z
  .object({
    fullName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional().nullable(),
    entityName: z.string().optional().nullable(),
    entityType: z.enum(["individual", "llc", "trust", "ira"]).optional().nullable(),
    address: z.string().optional().nullable(),
    ssnEinLast4: z
      .string()
      .regex(/^\d{4}$/, "Must be 4 digits")
      .optional()
      .nullable(),
    accredited: z.boolean().optional(),
    accreditedVerifiedAt: z.coerce.date().optional().nullable(),
    notes: z.string().optional().nullable(),
    tags: z.array(z.string()).optional(),
    portalEnabled: z.boolean().optional(),
  })
  .strict();

const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({ search: z.string().optional() }).optional();

const importBody = z
  .object({
    csv: z.string().min(1),
    commit: z.boolean().optional().default(false),
  })
  .strict();

export const investorsRouter = Router();

investorsRouter.use(requireAuth, requireRole("gp"));

investorsRouter.get("/", validate({ query: listQuery as any }), async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  res.json(await listInvestors({ search }));
});

investorsRouter.post(
  "/",
  validate({ body: investorBody }),
  async (req: AuthedRequest, res) => {
    const existing = await getInvestorByEmail(req.body.email);
    if (existing) return res.status(409).json({ error: "Email already exists" });
    const created = await createInvestor(req.body as InvestorInput, auditCtx(req));
    res.status(201).json(created);
  }
);

investorsRouter.get("/:id", validate({ params: idParams }), async (req, res) => {
  const investor = await getInvestorById(req.params.id);
  if (!investor) return res.status(404).json({ error: "Not found" });
  const [positions, communications] = await Promise.all([
    listPositionsByInvestor(req.params.id),
    listCommunicationsByInvestor(req.params.id),
  ]);
  res.json({ investor, positions, communications });
});

investorsRouter.put(
  "/:id",
  validate({ params: idParams, body: investorBody.partial() }),
  async (req: AuthedRequest, res) => {
    const updated = await updateInvestor(
      req.params.id,
      req.body as Partial<InvestorInput>,
      auditCtx(req)
    );
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  }
);

investorsRouter.delete(
  "/:id",
  validate({ params: idParams }),
  async (req: AuthedRequest, res) => {
    const ok = await deleteInvestor(req.params.id, auditCtx(req));
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  }
);

/**
 * CSV import — accepts Appfolio Investment Manager export format.
 * When commit=false (default), returns a preview: what would be imported,
 * skipped (dup email), or errored. commit=true actually writes.
 *
 * Appfolio column → internal field mapping (PRD §7):
 *   Contact Name  → fullName
 *   Email         → email
 *   Phone         → phone
 *   Entity Name   → entityName
 *   Address       → address (encrypted at rest)
 */
investorsRouter.post(
  "/import",
  validate({ body: importBody }),
  async (req: AuthedRequest, res) => {
    const { csv, commit } = req.body as z.infer<typeof importBody>;

    const parsed = Papa.parse<Record<string, string>>(csv, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    if (parsed.errors.length > 0) {
      return res.status(400).json({ error: "CSV parse error", details: parsed.errors.slice(0, 10) });
    }

    const rows = parsed.data;

    // Header aliases — be permissive: Appfolio users sometimes export with
    // slight variations.
    const pick = (row: Record<string, string>, keys: string[]) => {
      for (const k of keys) {
        for (const key of Object.keys(row)) {
          if (key.toLowerCase() === k.toLowerCase()) return row[key]?.trim() || null;
        }
      }
      return null;
    };

    const plan: Array<
      | { row: number; status: "create"; input: InvestorInput }
      | { row: number; status: "skip-duplicate"; email: string }
      | { row: number; status: "error"; message: string }
    > = [];
    const seenEmails = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const fullName = pick(r, ["Contact Name", "Full Name", "Name"]);
      const email = pick(r, ["Email", "Email Address"]);
      if (!fullName || !email) {
        plan.push({ row: i + 2, status: "error", message: "Missing name or email" });
        continue;
      }
      const lowerEmail = email.toLowerCase();
      if (seenEmails.has(lowerEmail)) {
        plan.push({ row: i + 2, status: "skip-duplicate", email: lowerEmail });
        continue;
      }
      seenEmails.add(lowerEmail);

      const existing = await getInvestorByEmail(lowerEmail);
      if (existing) {
        plan.push({ row: i + 2, status: "skip-duplicate", email: lowerEmail });
        continue;
      }

      plan.push({
        row: i + 2,
        status: "create",
        input: {
          fullName,
          email: lowerEmail,
          phone: pick(r, ["Phone", "Phone Number"]),
          entityName: pick(r, ["Entity Name", "Investing Entity", "Entity"]),
          entityType: null,
          address: pick(r, ["Address", "Mailing Address"]),
          notes: null,
          tags: [],
          importedFrom: "appfolio",
        },
      });
    }

    if (!commit) {
      const summary = {
        total: rows.length,
        toCreate: plan.filter((p) => p.status === "create").length,
        toSkip: plan.filter((p) => p.status === "skip-duplicate").length,
        errors: plan.filter((p) => p.status === "error").length,
      };
      return res.json({ preview: true, summary, plan });
    }

    const ctx = auditCtx(req);
    const created: Array<{ id: string; email: string }> = [];
    const errors: Array<{ row: number; message: string }> = [];
    for (const p of plan) {
      if (p.status !== "create") continue;
      try {
        const inv = await createInvestor(p.input, ctx);
        created.push({ id: inv.id, email: inv.email });
      } catch (e: any) {
        errors.push({ row: p.row, message: e?.message ?? "Insert failed" });
      }
    }
    res.json({
      committed: true,
      createdCount: created.length,
      skippedCount: plan.filter((p) => p.status === "skip-duplicate").length,
      errorCount: errors.length,
      errors,
    });
  }
);
