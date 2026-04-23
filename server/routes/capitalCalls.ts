import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth";
import { auditCtx } from "../middleware/auditCtx";
import { validate } from "../middleware/validate";
import {
  createCall,
  recordReceipt,
  closeCall,
  listCapitalCalls,
  getCallDetail,
} from "../services/capitalCallService";
import { HttpError } from "../services/distributionService";

const moneyString = z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Expected NUMERIC(18,2)");
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createSchema = z
  .object({
    dealId: z.string().uuid(),
    callDate: dateString,
    dueDate: dateString.optional().nullable(),
    amountTotal: moneyString,
    notes: z.string().optional().nullable(),
  })
  .strict();

const receiptSchema = z
  .object({
    responseId: z.string().uuid(),
    amountReceived: moneyString,
    receivedAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
    paymentMethod: z.enum(["check", "ach", "wire"]),
    paymentRef: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  })
  .strict();

const listQuery = z
  .object({
    dealId: z.string().uuid().optional(),
    status: z.enum(["open", "closed"]).optional(),
  })
  .strict();

const idParams = z.object({ id: z.string().uuid() });

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

export const capitalCallsRouter = Router();

capitalCallsRouter.use(requireAuth, requireRole("gp"));

capitalCallsRouter.post(
  "/",
  validate({ body: createSchema }),
  h(async (req, res) => {
    const result = await createCall(req.body as z.infer<typeof createSchema>, auditCtx(req));
    res.status(201).json(result);
  })
);

capitalCallsRouter.post(
  "/:id/receipts",
  validate({ params: idParams, body: receiptSchema }),
  h(async (req, res) => {
    const result = await recordReceipt(
      req.params.id,
      req.body as z.infer<typeof receiptSchema>,
      auditCtx(req)
    );
    res.status(201).json(result);
  })
);

capitalCallsRouter.post(
  "/:id/close",
  validate({ params: idParams }),
  h(async (req, res) => {
    const result = await closeCall(req.params.id, auditCtx(req));
    res.json(result);
  })
);

capitalCallsRouter.get(
  "/",
  validate({ query: listQuery }),
  h(async (req, res) => {
    res.json(await listCapitalCalls(req.query as z.infer<typeof listQuery>));
  })
);

capitalCallsRouter.get(
  "/:id",
  validate({ params: idParams }),
  h(async (req, res) => {
    const detail = await getCallDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: "Not found" });
    res.json(detail);
  })
);
