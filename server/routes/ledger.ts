import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db";
import { financialEvents, deals, investors } from "@shared/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";

/**
 * Immutable financial-events ledger — read-only exposure.
 *
 * The client calls this from `/admin/ledger`. No write endpoint exists on
 * this router; the ledger is populated by the service layer inside its
 * own DB transactions. Treat this router as a pure query view.
 */

const listQuery = z
  .object({
    dealId: z.string().uuid().optional(),
    investorId: z.string().uuid().optional(),
    eventType: z
      .enum(["capital_funded", "distribution_paid", "pref_paid", "capital_returned", "profit_split"])
      .optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();

export const ledgerRouter = Router();

ledgerRouter.use(requireAuth, requireRole("gp"));

ledgerRouter.get(
  "/",
  validate({ query: listQuery }),
  async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const wheres = [];
    if (q.dealId) wheres.push(eq(financialEvents.dealId, q.dealId));
    if (q.investorId) wheres.push(eq(financialEvents.investorId, q.investorId));
    if (q.eventType) wheres.push(eq(financialEvents.eventType, q.eventType));
    if (q.startDate) wheres.push(sql`${financialEvents.effectiveDate} >= ${q.startDate}`);
    if (q.endDate) wheres.push(sql`${financialEvents.effectiveDate} <= ${q.endDate}`);

    const rows = await db
      .select({
        event: financialEvents,
        dealName: deals.name,
        investorName: investors.fullName,
        investorEmail: investors.email,
      })
      .from(financialEvents)
      .leftJoin(deals, eq(financialEvents.dealId, deals.id))
      .leftJoin(investors, eq(financialEvents.investorId, investors.id))
      .where(wheres.length ? and(...wheres) : undefined)
      .orderBy(desc(financialEvents.effectiveDate), desc(financialEvents.createdAt))
      .limit(q.limit);

    // Aggregate summary per event_type for the filter set.
    const [summary] = await db
      .select({
        total: sql<string>`coalesce(sum(${financialEvents.amount}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(financialEvents)
      .where(wheres.length ? and(...wheres) : undefined);

    res.json({ rows, summary });
  }
);
