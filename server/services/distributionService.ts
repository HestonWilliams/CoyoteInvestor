import { and, eq, desc, sql, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@db";
import {
  deals,
  positions,
  waterfallConfigs,
  distributions,
  distributionLineItems,
  financialEvents,
  investors,
  type Distribution,
  type DistributionLineItem,
  type FinancialEvent,
  type FinancialEventType,
  type NewFinancialEvent,
} from "@shared/schema";
import {
  calculateDistribution,
  type DistributionType,
  type DistributionLineItemDraft,
} from "../lib/waterfall";
import { writeAudit, type AuditContext } from "./audit";
import { sendEmail } from "../emails/client";
import { renderDistributionNotice } from "../emails/distributionNotice";

/**
 * Distribution workflow (PRD §5.9 + Phase 2 checklist).
 *
 * Lifecycle:  draft  →  approved  →  paid
 *             └─ void (only while draft or approved, never paid)
 *
 * Money integrity rules:
 *   - markPaid runs as a single DB transaction that writes the paid status,
 *     persists line items, AND inserts one financial_events row per paid
 *     component (pref_paid / profit_split / capital_returned). Either all
 *     three stick or none do.
 *   - financial_events are never updated/deleted — the service has no code
 *     path that issues UPDATE/DELETE against that table. Void of a paid
 *     distribution is rejected at the status check; a paid distribution
 *     that must be reversed needs a compensating (negative-direction) new
 *     distribution record, not a ledger rewrite.
 *   - Emails are sent AFTER the transaction commits. A Resend failure logs
 *     to audit_log and does not roll back the paid state.
 */

export interface CreateDraftParams {
  dealId: string;
  type: DistributionType;
  totalAmount: string;
  distributionDate: string; // YYYY-MM-DD
  notes?: string | null;
}

export interface UpdateLineItemOverrideParams {
  grossAmount?: string;
  prefComponent?: string;
  returnOfCapital?: string;
  profitSplit?: string;
  netAmount?: string;
  reason: string;
}

export interface MarkPaidLineItemInput {
  lineItemId: string;
  paymentMethod: "check" | "ach" | "wire";
  paymentRef?: string | null;
}

// ---- Draft creation ------------------------------------------------

export async function createDraft(
  params: CreateDraftParams,
  ctx: AuditContext
): Promise<{ distribution: Distribution; lineItems: DistributionLineItem[] }> {
  const [deal] = await db.select().from(deals).where(eq(deals.id, params.dealId)).limit(1);
  if (!deal) throw new HttpError(404, "Deal not found");

  const dealPositions = await db
    .select()
    .from(positions)
    .where(eq(positions.dealId, params.dealId));
  if (dealPositions.length === 0) {
    throw new HttpError(400, "Deal has no positions; nothing to distribute to");
  }

  const [config] = await db
    .select()
    .from(waterfallConfigs)
    .where(eq(waterfallConfigs.dealId, params.dealId))
    .limit(1);
  if (!config) {
    throw new HttpError(
      400,
      "Waterfall config missing for this deal. Configure pref/split before creating a distribution."
    );
  }

  // Build prefPaidToDate by summing pref_component across every prior
  // distribution_line_item joined to a paid distribution for this deal.
  const positionIds = dealPositions.map((p) => p.id);
  const prefPaidRows =
    positionIds.length === 0
      ? []
      : await db
          .select({
            positionId: distributionLineItems.positionId,
            sum: sql<string>`coalesce(sum(${distributionLineItems.prefComponent}), 0)::text`,
          })
          .from(distributionLineItems)
          .innerJoin(distributions, eq(distributions.id, distributionLineItems.distributionId))
          .where(
            and(
              eq(distributions.status, "paid"),
              eq(distributions.dealId, params.dealId),
              inArray(distributionLineItems.positionId, positionIds)
            )
          )
          .groupBy(distributionLineItems.positionId);

  const prefPaidToDate: Record<string, string> = {};
  for (const row of prefPaidRows) prefPaidToDate[row.positionId] = row.sum ?? "0";

  const drafts: DistributionLineItemDraft[] = calculateDistribution({
    deal,
    positions: dealPositions,
    config,
    totalAmount: params.totalAmount,
    distributionType: params.type,
    prefPaidToDate,
    effectiveDate: new Date(params.distributionDate),
  });

  // Insert distribution (draft) + line items in a transaction.
  const result = await db.transaction(async (tx) => {
    const [dist] = await tx
      .insert(distributions)
      .values({
        dealId: params.dealId,
        distributionDate: params.distributionDate,
        type: params.type,
        totalAmount: new Decimal(params.totalAmount).toFixed(2),
        status: "draft",
        notes: params.notes ?? null,
      })
      .returning();

    const itemsToInsert = drafts
      .filter((d) => Number(d.grossAmount) > 0)
      .map((d) => ({
        distributionId: dist.id,
        investorId: d.investorId,
        positionId: d.positionId,
        grossAmount: d.grossAmount,
        prefComponent: d.prefComponent,
        returnOfCapital: d.returnOfCapital,
        profitSplit: d.profitSplit,
        netAmount: d.netAmount,
        paymentStatus: "pending" as const,
      }));

    const lineItems =
      itemsToInsert.length === 0
        ? []
        : await tx.insert(distributionLineItems).values(itemsToInsert).returning();

    return { distribution: dist, lineItems };
  });

  await writeAudit(ctx, {
    tableName: "distributions",
    recordId: result.distribution.id,
    action: "INSERT",
    newValues: {
      dealId: result.distribution.dealId,
      type: result.distribution.type,
      totalAmount: result.distribution.totalAmount,
      lineItemCount: result.lineItems.length,
    },
  });

  return result;
}

// ---- Read helpers --------------------------------------------------

export async function listDistributions(filters: {
  dealId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}) {
  const wheres = [];
  if (filters.dealId) wheres.push(eq(distributions.dealId, filters.dealId));
  if (filters.status) wheres.push(eq(distributions.status, filters.status));
  if (filters.startDate)
    wheres.push(sql`${distributions.distributionDate} >= ${filters.startDate}`);
  if (filters.endDate)
    wheres.push(sql`${distributions.distributionDate} <= ${filters.endDate}`);

  const rows = await db
    .select({
      distribution: distributions,
      dealName: deals.name,
    })
    .from(distributions)
    .leftJoin(deals, eq(distributions.dealId, deals.id))
    .where(wheres.length ? and(...wheres) : undefined)
    .orderBy(desc(distributions.distributionDate));
  return rows;
}

export async function getDistributionDetail(id: string) {
  const [distribution] = await db
    .select()
    .from(distributions)
    .where(eq(distributions.id, id))
    .limit(1);
  if (!distribution) return null;
  const lineItems = await db
    .select({
      item: distributionLineItems,
      investorFullName: investors.fullName,
      investorEmail: investors.email,
    })
    .from(distributionLineItems)
    .leftJoin(investors, eq(distributionLineItems.investorId, investors.id))
    .where(eq(distributionLineItems.distributionId, id));
  return { distribution, lineItems };
}

export async function getDraftPreview(id: string) {
  return getDistributionDetail(id);
}

// ---- Line item override (GP manual edit) ---------------------------

export async function updateLineItemOverride(
  distributionId: string,
  lineItemId: string,
  patch: UpdateLineItemOverrideParams,
  ctx: AuditContext
): Promise<DistributionLineItem> {
  const [dist] = await db
    .select()
    .from(distributions)
    .where(eq(distributions.id, distributionId))
    .limit(1);
  if (!dist) throw new HttpError(404, "Distribution not found");
  if (dist.status !== "draft") {
    throw new HttpError(409, "Overrides allowed only on draft distributions");
  }

  const [existing] = await db
    .select()
    .from(distributionLineItems)
    .where(
      and(
        eq(distributionLineItems.id, lineItemId),
        eq(distributionLineItems.distributionId, distributionId)
      )
    )
    .limit(1);
  if (!existing) throw new HttpError(404, "Line item not found");

  const updates: Partial<DistributionLineItem> = {};
  if (patch.grossAmount !== undefined)
    updates.grossAmount = new Decimal(patch.grossAmount).toFixed(2);
  if (patch.prefComponent !== undefined)
    updates.prefComponent = new Decimal(patch.prefComponent).toFixed(2);
  if (patch.returnOfCapital !== undefined)
    updates.returnOfCapital = new Decimal(patch.returnOfCapital).toFixed(2);
  if (patch.profitSplit !== undefined)
    updates.profitSplit = new Decimal(patch.profitSplit).toFixed(2);
  if (patch.netAmount !== undefined)
    updates.netAmount = new Decimal(patch.netAmount).toFixed(2);

  const [updated] = await db
    .update(distributionLineItems)
    .set(updates)
    .where(eq(distributionLineItems.id, lineItemId))
    .returning();

  await writeAudit(ctx, {
    tableName: "distribution_line_items",
    recordId: lineItemId,
    action: "UPDATE",
    oldValues: {
      grossAmount: existing.grossAmount,
      prefComponent: existing.prefComponent,
      returnOfCapital: existing.returnOfCapital,
      profitSplit: existing.profitSplit,
      netAmount: existing.netAmount,
    },
    newValues: {
      grossAmount: updated.grossAmount,
      prefComponent: updated.prefComponent,
      returnOfCapital: updated.returnOfCapital,
      profitSplit: updated.profitSplit,
      netAmount: updated.netAmount,
      override_reason: patch.reason,
    },
  });

  return updated;
}

// ---- Approval ------------------------------------------------------

export async function approveDistribution(
  id: string,
  ctx: AuditContext
): Promise<Distribution> {
  const [existing] = await db
    .select()
    .from(distributions)
    .where(eq(distributions.id, id))
    .limit(1);
  if (!existing) throw new HttpError(404, "Distribution not found");
  if (existing.status !== "draft") {
    throw new HttpError(409, `Cannot approve from status '${existing.status}'`);
  }
  const [updated] = await db
    .update(distributions)
    .set({ status: "approved" })
    .where(eq(distributions.id, id))
    .returning();
  await writeAudit(ctx, {
    tableName: "distributions",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: existing.status },
    newValues: { status: updated.status, event: "approved" },
  });
  return updated;
}

// ---- Mark Paid — atomic DB tx + financial_events + emails ---------

export async function markDistributionPaid(
  id: string,
  payments: MarkPaidLineItemInput[],
  ctx: AuditContext
): Promise<{ distribution: Distribution; eventsWritten: number }> {
  const [existing] = await db
    .select()
    .from(distributions)
    .where(eq(distributions.id, id))
    .limit(1);
  if (!existing) throw new HttpError(404, "Distribution not found");
  if (existing.status !== "approved") {
    throw new HttpError(409, `Cannot mark paid from status '${existing.status}'`);
  }

  const existingLineItems = await db
    .select()
    .from(distributionLineItems)
    .where(eq(distributionLineItems.distributionId, id));
  if (existingLineItems.length === 0) {
    throw new HttpError(400, "Distribution has no line items to pay");
  }

  // Build a per-line payment map; require one entry per line item.
  const paymentByLineId = new Map(payments.map((p) => [p.lineItemId, p]));
  for (const li of existingLineItems) {
    if (!paymentByLineId.has(li.id)) {
      throw new HttpError(400, `Missing payment details for line item ${li.id}`);
    }
  }

  const createdBy = ctx.changedBy ?? "system";

  // ---- The atomic section. Line item update + financial_events insert +
  // distribution status flip all live in the same transaction. Emails are
  // sent outside the transaction so a Resend outage can't undo a paid mark.
  const { distribution, eventsInserted } = await db.transaction(async (tx) => {
    const events: NewFinancialEvent[] = [];

    for (const li of existingLineItems) {
      const pay = paymentByLineId.get(li.id)!;
      await tx
        .update(distributionLineItems)
        .set({
          paymentStatus: "sent",
          paymentMethod: pay.paymentMethod,
          paymentRef: pay.paymentRef ?? null,
        })
        .where(eq(distributionLineItems.id, li.id));

      // One financial_events row per non-zero leg. Components are always
      // positive; event_type distinguishes pref / profit / ROC.
      const legs: Array<[FinancialEventType, string, string]> = [
        ["pref_paid", li.prefComponent, "preferred return"],
        ["profit_split", li.profitSplit, "profit share"],
        ["capital_returned", li.returnOfCapital, "return of capital"],
      ];
      for (const [eventType, amount, memo] of legs) {
        if (new Decimal(amount).lte(0)) continue;
        events.push({
          eventType,
          dealId: existing.dealId,
          investorId: li.investorId,
          positionId: li.positionId,
          amount,
          effectiveDate: existing.distributionDate,
          referenceId: id,
          referenceTable: "distributions",
          memo,
          createdBy,
        });
      }
    }

    if (events.length > 0) {
      await tx.insert(financialEvents).values(events);
    }

    const [dist] = await tx
      .update(distributions)
      .set({ status: "paid" })
      .where(eq(distributions.id, id))
      .returning();

    return { distribution: dist, eventsInserted: events.length };
  });

  await writeAudit(ctx, {
    tableName: "distributions",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: existing.status },
    newValues: {
      status: distribution.status,
      event: "mark_paid",
      financialEventsWritten: eventsInserted,
    },
  });

  // ---- Post-commit: send distribution notices. Failures are isolated and
  // logged via audit_log (see emails/client.ts). Never throws.
  const [deal] = await db.select().from(deals).where(eq(deals.id, existing.dealId)).limit(1);
  const dealName = deal?.name ?? "Coyote Equity Deal";

  for (const li of existingLineItems) {
    const [investor] = await db
      .select()
      .from(investors)
      .where(eq(investors.id, li.investorId))
      .limit(1);
    if (!investor) continue;
    const pay = paymentByLineId.get(li.id)!;
    await sendEmail(
      renderDistributionNotice({
        investorName: investor.fullName,
        investorEmail: investor.email,
        dealName,
        distributionDate: existing.distributionDate,
        type: existing.type,
        grossAmount: li.grossAmount,
        prefComponent: li.prefComponent,
        returnOfCapital: li.returnOfCapital,
        profitSplit: li.profitSplit,
        netAmount: li.netAmount,
        paymentMethod: pay.paymentMethod,
        paymentRef: pay.paymentRef ?? null,
      }),
      { tableName: "distributions", recordId: id, purpose: "distribution_notice" }
    );
  }

  // Confirm payment status on line items (receipts acknowledged once emails
  // return). This is idempotent; a later re-run is harmless.
  if (existingLineItems.length > 0) {
    await db
      .update(distributionLineItems)
      .set({ paymentStatus: "confirmed" })
      .where(eq(distributionLineItems.distributionId, id));
  }

  return { distribution, eventsWritten: eventsInserted };
}

// ---- Void (draft/approved only — NEVER paid) -----------------------

export async function voidDistribution(
  id: string,
  reason: string,
  ctx: AuditContext
): Promise<void> {
  const [existing] = await db
    .select()
    .from(distributions)
    .where(eq(distributions.id, id))
    .limit(1);
  if (!existing) throw new HttpError(404, "Distribution not found");
  if (existing.status === "paid") {
    throw new HttpError(
      409,
      "A paid distribution cannot be voided. Issue a compensating distribution instead."
    );
  }

  // Delete the distribution row (cascade removes draft line items). No
  // financial_events rows exist yet for an unpaid distribution, so nothing
  // to reconcile in the ledger.
  await db.delete(distributions).where(eq(distributions.id, id));

  await writeAudit(ctx, {
    tableName: "distributions",
    recordId: id,
    action: "DELETE",
    oldValues: {
      status: existing.status,
      dealId: existing.dealId,
      totalAmount: existing.totalAmount,
    },
    newValues: { event: "void", reason },
  });
}

// ---- Errors --------------------------------------------------------

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
