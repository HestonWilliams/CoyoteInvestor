import Decimal from "decimal.js";
import { and, eq, desc, sql } from "drizzle-orm";
import { db } from "@db";
import {
  deals,
  positions,
  investors,
  capitalCalls,
  capitalCallResponses,
  financialEvents,
  type CapitalCall,
  type CapitalCallResponse,
  type NewFinancialEvent,
} from "@shared/schema";
import { writeAudit, type AuditContext } from "./audit";
import { sendEmail } from "../emails/client";
import { renderCapitalCallNotice } from "../emails/capitalCallNotice";
import { HttpError } from "./distributionService";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/**
 * Capital call workflow (PRD §5.3 + Phase 2 checklist).
 *
 * createCall
 *   Computes each investor's pro-rata call by committed_amount / total_equity,
 *   inserts a capital_call + one response per position, then sends one
 *   Resend notice per investor. Sending is post-commit and isolated.
 *
 * recordReceipt
 *   Single DB transaction:
 *     1. Update capital_call_responses with amount + receivedAt + method
 *     2. Bump positions.funded_amount (capped at committed_amount)
 *     3. Insert a financial_events row with event_type=capital_funded
 *     4. Recompute capital_calls.total_received
 *   Ledger integrity: every dollar received is mirrored in financial_events
 *   atomically with the positions update.
 *
 * closeCall
 *   Simple status flip; does not write financial_events.
 */

export interface CreateCallParams {
  dealId: string;
  callDate: string; // YYYY-MM-DD
  dueDate?: string | null;
  amountTotal: string; // total to be called across all investors
  notes?: string | null;
}

export interface RecordReceiptParams {
  responseId: string;
  amountReceived: string;
  receivedAt: string; // ISO
  paymentMethod: "check" | "ach" | "wire";
  paymentRef?: string | null;
  notes?: string | null;
}

// ---- Create call --------------------------------------------------

export async function createCall(params: CreateCallParams, ctx: AuditContext) {
  const [deal] = await db.select().from(deals).where(eq(deals.id, params.dealId)).limit(1);
  if (!deal) throw new HttpError(404, "Deal not found");

  const dealPositions = await db
    .select({ position: positions, investor: investors })
    .from(positions)
    .leftJoin(investors, eq(positions.investorId, investors.id))
    .where(eq(positions.dealId, params.dealId));

  if (dealPositions.length === 0) {
    throw new HttpError(400, "Deal has no positions to call");
  }

  const totalCommitted = dealPositions.reduce(
    (acc, r) => acc.plus(new Decimal(r.position.committedAmount ?? 0)),
    new Decimal(0)
  );
  if (totalCommitted.lte(0)) {
    throw new HttpError(400, "Total committed across positions is zero — cannot compute pro-rata");
  }

  const amountTotal = new Decimal(params.amountTotal);

  // Pro-rata per position. Use decimal.js throughout, then round per row and
  // park any drift on the largest committed position so the sum == target.
  const rawPerInvestor = dealPositions.map((r) => {
    const committed = new Decimal(r.position.committedAmount ?? 0);
    const share = committed.div(totalCommitted);
    return {
      position: r.position,
      investor: r.investor,
      share,
      amountCalled: amountTotal.mul(share),
    };
  });

  const rounded = rawPerInvestor.map((r) => ({
    ...r,
    rounded: r.amountCalled.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
  }));
  const sumRounded = rounded.reduce((acc, r) => acc.plus(r.rounded), new Decimal(0));
  const drift = amountTotal.minus(sumRounded);
  if (!drift.eq(0) && rounded.length > 0) {
    // Adjust the largest committed-amount row so rounding is least visible.
    let target = rounded[0];
    for (const r of rounded) {
      if (new Decimal(r.position.committedAmount ?? 0).gt(new Decimal(target.position.committedAmount ?? 0))) {
        target = r;
      }
    }
    target.rounded = target.rounded.plus(drift);
  }

  const result = await db.transaction(async (tx) => {
    const [call] = await tx
      .insert(capitalCalls)
      .values({
        dealId: params.dealId,
        callDate: params.callDate,
        dueDate: params.dueDate ?? null,
        amountPerUnit: null, // pro-rata-by-commitment model, not per-unit
        totalCalled: amountTotal.toFixed(2),
        totalReceived: "0",
        status: "open",
        notes: params.notes ?? null,
      })
      .returning();

    const responses =
      rounded.length === 0
        ? []
        : await tx
            .insert(capitalCallResponses)
            .values(
              rounded.map((r) => ({
                capitalCallId: call.id,
                investorId: r.position.investorId,
                amountCalled: r.rounded.toFixed(2),
                amountReceived: "0",
              }))
            )
            .returning();

    return { call, responses };
  });

  await writeAudit(ctx, {
    tableName: "capital_calls",
    recordId: result.call.id,
    action: "INSERT",
    newValues: {
      dealId: params.dealId,
      totalCalled: result.call.totalCalled,
      responseCount: result.responses.length,
    },
  });

  // ---- Post-commit emails.
  const dealName = deal.name;
  for (const r of rounded) {
    if (!r.investor) continue;
    await sendEmail(
      renderCapitalCallNotice({
        investorName: r.investor.fullName,
        investorEmail: r.investor.email,
        dealName,
        callDate: params.callDate,
        dueDate: params.dueDate ?? null,
        amountDue: r.rounded.toFixed(2),
        totalCommitted: new Decimal(r.position.committedAmount ?? 0).toFixed(2),
        notes: params.notes ?? null,
      }),
      {
        tableName: "capital_calls",
        recordId: result.call.id,
        purpose: "capital_call_notice",
      }
    );
  }

  return result;
}

// ---- Record receipt -----------------------------------------------

export async function recordReceipt(
  callId: string,
  params: RecordReceiptParams,
  ctx: AuditContext
): Promise<CapitalCallResponse> {
  const [call] = await db
    .select()
    .from(capitalCalls)
    .where(eq(capitalCalls.id, callId))
    .limit(1);
  if (!call) throw new HttpError(404, "Capital call not found");
  if (call.status !== "open") {
    throw new HttpError(409, `Cannot record receipt on a ${call.status} call`);
  }

  const [response] = await db
    .select()
    .from(capitalCallResponses)
    .where(
      and(
        eq(capitalCallResponses.id, params.responseId),
        eq(capitalCallResponses.capitalCallId, callId)
      )
    )
    .limit(1);
  if (!response) throw new HttpError(404, "Response not found");

  // Find the position to update funded_amount on. Match by (deal, investor).
  const [position] = await db
    .select()
    .from(positions)
    .where(
      and(eq(positions.dealId, call.dealId), eq(positions.investorId, response.investorId))
    )
    .limit(1);
  if (!position) {
    throw new HttpError(
      400,
      "No position found for this investor on the deal — cannot credit funding"
    );
  }

  const amountReceived = new Decimal(params.amountReceived);
  if (amountReceived.lte(0)) {
    throw new HttpError(400, "amountReceived must be positive");
  }

  const createdBy = ctx.changedBy ?? "system";

  const result = await db.transaction(async (tx) => {
    // 1. Update the response row
    const [updated] = await tx
      .update(capitalCallResponses)
      .set({
        amountReceived: new Decimal(response.amountReceived)
          .plus(amountReceived)
          .toFixed(2),
        receivedAt: new Date(params.receivedAt),
        paymentMethod: params.paymentMethod,
        notes: params.notes ?? response.notes,
      })
      .where(eq(capitalCallResponses.id, params.responseId))
      .returning();

    // 2. Bump positions.funded_amount, capped at committed_amount.
    const committed = new Decimal(position.committedAmount);
    const currentFunded = new Decimal(position.fundedAmount);
    const remainingRoom = Decimal.max(new Decimal(0), committed.minus(currentFunded));
    const fundingDelta = Decimal.min(remainingRoom, amountReceived);
    const newFunded = currentFunded.plus(fundingDelta);

    const positionUpdates: Record<string, unknown> = {
      fundedAmount: newFunded.toFixed(2),
    };
    if (newFunded.gt(currentFunded)) {
      if (!position.fundedAt) positionUpdates.fundedAt = new Date(params.receivedAt);
      if (newFunded.gte(committed) && position.status !== "funded") {
        positionUpdates.status = "funded";
      }
    }
    await tx.update(positions).set(positionUpdates).where(eq(positions.id, position.id));

    // 3. Financial event — always record the full amount received, even if
    // some of it exceeds committed (overfunded positions happen; don't
    // silently drop the dollars on the ledger floor).
    const event: NewFinancialEvent = {
      eventType: "capital_funded",
      dealId: call.dealId,
      investorId: response.investorId,
      positionId: position.id,
      amount: amountReceived.toFixed(2),
      effectiveDate: params.receivedAt.slice(0, 10),
      referenceId: callId,
      referenceTable: "capital_calls",
      memo: params.paymentRef ? `${params.paymentMethod} · ${params.paymentRef}` : params.paymentMethod,
      createdBy,
    };
    await tx.insert(financialEvents).values(event);

    // 4. Recompute total_received on the parent call.
    const [totals] = await tx
      .select({
        total: sql<string>`coalesce(sum(${capitalCallResponses.amountReceived}), 0)::text`,
      })
      .from(capitalCallResponses)
      .where(eq(capitalCallResponses.capitalCallId, callId));
    await tx
      .update(capitalCalls)
      .set({ totalReceived: totals?.total ?? "0" })
      .where(eq(capitalCalls.id, callId));

    return updated;
  });

  await writeAudit(ctx, {
    tableName: "capital_call_responses",
    recordId: params.responseId,
    action: "UPDATE",
    oldValues: { amountReceived: response.amountReceived },
    newValues: {
      amountReceived: result.amountReceived,
      event: "receipt",
      paymentMethod: params.paymentMethod,
      paymentRef: params.paymentRef ?? null,
    },
  });

  return result;
}

// ---- Close call ---------------------------------------------------

export async function closeCall(callId: string, ctx: AuditContext): Promise<CapitalCall> {
  const [existing] = await db
    .select()
    .from(capitalCalls)
    .where(eq(capitalCalls.id, callId))
    .limit(1);
  if (!existing) throw new HttpError(404, "Capital call not found");
  if (existing.status === "closed") return existing;

  const [row] = await db
    .update(capitalCalls)
    .set({ status: "closed" })
    .where(eq(capitalCalls.id, callId))
    .returning();
  await writeAudit(ctx, {
    tableName: "capital_calls",
    recordId: callId,
    action: "UPDATE",
    oldValues: { status: existing.status },
    newValues: { status: "closed" },
  });
  return row;
}

// ---- Read helpers -------------------------------------------------

export async function listCapitalCalls(filters: { dealId?: string; status?: string }) {
  const wheres = [];
  if (filters.dealId) wheres.push(eq(capitalCalls.dealId, filters.dealId));
  if (filters.status) wheres.push(eq(capitalCalls.status, filters.status));
  return db
    .select({
      call: capitalCalls,
      dealName: deals.name,
    })
    .from(capitalCalls)
    .leftJoin(deals, eq(capitalCalls.dealId, deals.id))
    .where(wheres.length ? and(...wheres) : undefined)
    .orderBy(desc(capitalCalls.callDate));
}

export async function getCallDetail(id: string) {
  const [call] = await db.select().from(capitalCalls).where(eq(capitalCalls.id, id)).limit(1);
  if (!call) return null;
  const responses = await db
    .select({
      response: capitalCallResponses,
      investorFullName: investors.fullName,
      investorEmail: investors.email,
    })
    .from(capitalCallResponses)
    .leftJoin(investors, eq(capitalCallResponses.investorId, investors.id))
    .where(eq(capitalCallResponses.capitalCallId, id));
  return { call, responses };
}
