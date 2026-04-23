import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth";
import { auditCtx } from "../middleware/auditCtx";
import {
  listDeals,
  getDealById,
  getDealDetail,
  createDeal,
  updateDeal,
  deleteDeal,
} from "../services/deals";

const dealBody = z
  .object({
    name: z.string().min(1),
    assetClass: z.enum(["self_storage", "multifamily", "land", "other"]).optional(),
    status: z.enum(["prospecting", "fundraising", "active", "exited"]).optional(),
    address: z.string().optional().nullable(),
    totalEquity: z.string().optional().nullable(),
    acquisitionPrice: z.string().optional().nullable(),
    currentValue: z.string().optional().nullable(),
    loanBalance: z.string().optional().nullable(),
    loanRate: z.string().optional().nullable(),
    loanMaturity: z.string().optional().nullable(),
    acquisitionDate: z.string().optional().nullable(),
    projectedExitDate: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  })
  .strict();

const idParams = z.object({ id: z.string().uuid() });

export const dealsRouter = Router();

dealsRouter.use(requireAuth, requireRole("gp"));

dealsRouter.get("/", async (_req, res) => {
  res.json(await listDeals());
});

dealsRouter.post("/", validate({ body: dealBody }), async (req: AuthedRequest, res) => {
  const deal = await createDeal(req.body as any, auditCtx(req));
  res.status(201).json(deal);
});

dealsRouter.get("/:id", validate({ params: idParams }), async (req, res) => {
  const detail = await getDealDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: "Not found" });
  res.json(detail);
});

dealsRouter.put(
  "/:id",
  validate({ params: idParams, body: dealBody.partial() }),
  async (req: AuthedRequest, res) => {
    const updated = await updateDeal(req.params.id, req.body as any, auditCtx(req));
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  }
);

dealsRouter.delete("/:id", validate({ params: idParams }), async (req: AuthedRequest, res) => {
  const ok = await deleteDeal(req.params.id, auditCtx(req));
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});
