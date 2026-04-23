import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth";
import { auditCtx } from "../middleware/auditCtx";
import { validate } from "../middleware/validate";
import {
  createDraft,
  listDistributions,
  getDistributionDetail,
  getDraftPreview,
  updateLineItemOverride,
  approveDistribution,
  markDistributionPaid,
  voidDistribution,
  HttpError,
} from "../services/distributionService";

const moneyString = z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Expected NUMERIC(18,2)");

const createSchema = z
  .object({
    dealId: z.string().uuid(),
    type: z.enum(["operating", "return_of_capital", "refinance", "sale"]),
    totalAmount: moneyString,
    distributionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().optional().nullable(),
  })
  .strict();

const listQuery = z
  .object({
    dealId: z.string().uuid().optional(),
    status: z.enum(["draft", "approved", "paid"]).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

const idParams = z.object({ id: z.string().uuid() });
const idWithLineParams = z.object({
  id: z.string().uuid(),
  liId: z.string().uuid(),
});

const overrideSchema = z
  .object({
    grossAmount: moneyString.optional(),
    prefComponent: moneyString.optional(),
    returnOfCapital: moneyString.optional(),
    profitSplit: moneyString.optional(),
    netAmount: moneyString.optional(),
    reason: z.string().min(3, "Reason required"),
  })
  .strict();

const markPaidSchema = z
  .object({
    payments: z
      .array(
        z
          .object({
            lineItemId: z.string().uuid(),
            paymentMethod: z.enum(["check", "ach", "wire"]),
            paymentRef: z.string().optional().nullable(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const voidSchema = z.object({ reason: z.string().min(3) }).strict();

/**
 * Distributions router — all GP-only.
 *
 * Route map:
 *   POST   /                          createDraft
 *   GET    /                          list (filter by dealId/status/date range)
 *   GET    /:id                       detail with line items
 *   GET    /:id/preview               alias for detail while in draft
 *   PATCH  /:id/line-items/:liId      updateLineItemOverride
 *   POST   /:id/approve               approve
 *   POST   /:id/mark-paid             markPaid (atomic tx + financial_events)
 *   POST   /:id/void                  void (draft/approved only, never paid)
 */

// Wrap async handlers to route rejections into the error middleware.
function h(fn: (req: AuthedRequest, res: Response) => Promise<unknown>) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ error: err.message });
      }
      next(err);
    }
  };
}

export const distributionsRouter = Router();

distributionsRouter.use(requireAuth, requireRole("gp"));

distributionsRouter.post(
  "/",
  validate({ body: createSchema }),
  h(async (req, res) => {
    const result = await createDraft(req.body as z.infer<typeof createSchema>, auditCtx(req));
    res.status(201).json(result);
  })
);

distributionsRouter.get(
  "/",
  validate({ query: listQuery }),
  h(async (req, res) => {
    const rows = await listDistributions(req.query as z.infer<typeof listQuery>);
    res.json(rows);
  })
);

distributionsRouter.get(
  "/:id",
  validate({ params: idParams }),
  h(async (req, res) => {
    const detail = await getDistributionDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: "Not found" });
    res.json(detail);
  })
);

distributionsRouter.get(
  "/:id/preview",
  validate({ params: idParams }),
  h(async (req, res) => {
    const detail = await getDraftPreview(req.params.id);
    if (!detail) return res.status(404).json({ error: "Not found" });
    res.json(detail);
  })
);

distributionsRouter.patch(
  "/:id/line-items/:liId",
  validate({ params: idWithLineParams, body: overrideSchema }),
  h(async (req, res) => {
    const updated = await updateLineItemOverride(
      req.params.id,
      (req.params as any).liId,
      req.body as z.infer<typeof overrideSchema>,
      auditCtx(req)
    );
    res.json(updated);
  })
);

distributionsRouter.post(
  "/:id/approve",
  validate({ params: idParams }),
  h(async (req, res) => {
    const result = await approveDistribution(req.params.id, auditCtx(req));
    res.json(result);
  })
);

distributionsRouter.post(
  "/:id/mark-paid",
  validate({ params: idParams, body: markPaidSchema }),
  h(async (req, res) => {
    const result = await markDistributionPaid(
      req.params.id,
      (req.body as z.infer<typeof markPaidSchema>).payments,
      auditCtx(req)
    );
    res.json(result);
  })
);

distributionsRouter.post(
  "/:id/void",
  validate({ params: idParams, body: voidSchema }),
  h(async (req, res) => {
    await voidDistribution(
      req.params.id,
      (req.body as z.infer<typeof voidSchema>).reason,
      auditCtx(req)
    );
    res.status(204).end();
  })
);
