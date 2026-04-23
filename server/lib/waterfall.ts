import Decimal from "decimal.js";
import type { Deal, Position, WaterfallConfig } from "@shared/schema";

/**
 * Distribution waterfall engine.
 *
 * PURE FUNCTION — zero DB access, zero I/O. Always called from the service
 * layer (distributionService.createDraft), never directly from a route
 * handler. This makes it trivially testable and deterministic.
 *
 * All arithmetic is done with decimal.js (arbitrary-precision decimals,
 * NUMERIC-safe). Results are rounded HALF_UP to 2 decimal places with a
 * final reconciliation pass that assigns any rounding drift to the largest
 * line item so the line-item total exactly equals the input `totalAmount`.
 *
 * Logic (PRD §5.9 / Phase 2 checklist):
 *   1. prefOwed[i]         = funded[i] × (prefPct/100) × daysSinceFunded[i] / 365
 *   2. prefOutstanding[i]  = max(0, prefOwed[i] - prefPaidToDate[i])
 *   3. Each position's bucket toward pref = totalAmount × ownershipPct[i]
 *      Actual pref paid     = min(bucket, prefOutstanding[i])
 *      Under-outstanding leftover flows to Step 4 (no redistribution).
 *   4. remaining = totalAmount - SUM(allPrefAllocations)
 *   5. lpPortion / gpPortion = remaining × lp_split_pct/gp_split_pct
 *      - LP positions (shareClass class_a | class_b) split lpPortion
 *        pro-rata by ownership_pct within the LP class.
 *      - GP positions (shareClass gp) split gpPortion pro-rata by
 *        ownership_pct within the GP class. If no GP positions exist,
 *        gpPortion is implicit (the deal operator's share, not recorded
 *        on any line item).
 *   6. distributionType === 'return_of_capital' routes the post-pref
 *      allocation into the return_of_capital field instead of profit_split.
 */

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DistributionType =
  | "operating"
  | "return_of_capital"
  | "refinance"
  | "sale";

export interface DistributionLineItemDraft {
  positionId: string;
  investorId: string;
  grossAmount: string; // all amounts returned as strings in NUMERIC(18,2) format
  prefComponent: string;
  returnOfCapital: string;
  profitSplit: string;
  netAmount: string;
}

interface WaterfallInputs {
  deal: Pick<Deal, "id">;
  positions: Position[];
  config: Pick<WaterfallConfig, "prefReturnPct" | "lpSplitPct" | "gpSplitPct">;
  totalAmount: number | string;
  distributionType: DistributionType;
  /** positionId → cumulative pref_paid across all prior distributions, in dollars. */
  prefPaidToDate: Record<string, number | string>;
  /** Effective distribution date — pref accrual anchor. Defaults to today. */
  effectiveDate?: Date;
}

const ZERO = new Decimal(0);

function D(v: number | string | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") return ZERO;
  return new Decimal(v);
}

function toMoney(v: Decimal): string {
  // NUMERIC(18,2) — round HALF_UP to 2 decimals and format as string.
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function daysBetween(earlier: Date, later: Date): number {
  const ms = later.getTime() - earlier.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export function calculateDistribution(
  input: WaterfallInputs
): DistributionLineItemDraft[] {
  const { positions, config, distributionType, prefPaidToDate } = input;
  const totalAmount = D(input.totalAmount);
  const prefPct = D(config.prefReturnPct);
  const lpSplit = D(config.lpSplitPct);
  const gpSplit = D(config.gpSplitPct);
  const effectiveDate = input.effectiveDate ?? new Date();

  if (totalAmount.lte(0)) {
    return positions.map((p) => emptyDraft(p));
  }

  // ---- Step 1 & 2: prefOwed and prefOutstanding per position -----------
  const prefOutstanding = new Map<string, Decimal>();
  for (const p of positions) {
    const funded = D(p.fundedAmount);
    const fundedAt = p.fundedAt ? new Date(p.fundedAt) : null;
    const days = fundedAt ? daysBetween(fundedAt, effectiveDate) : 0;

    const prefOwed = funded
      .mul(prefPct)
      .div(100)
      .mul(days)
      .div(365);
    const paid = D(prefPaidToDate[p.id]);
    const outstanding = Decimal.max(ZERO, prefOwed.minus(paid));
    prefOutstanding.set(p.id, outstanding);
  }

  // ---- Step 3: pro-rata pref allocation, capped at per-position outstanding.
  // Each position's "bucket" for pref = totalAmount × ownership_pct (on a 0-100 scale).
  // If the bucket exceeds this position's outstanding, the position takes
  // only the outstanding; the leftover flows to Step 4 via "remaining".
  // If the bucket is below outstanding, this position is partially paid —
  // no redistribution within pref, per PRD "no LP is made whole before others".
  const prefAllocated = new Map<string, Decimal>();
  for (const p of positions) {
    const ownership = D(p.ownershipPct).div(100); // ownership_pct is stored 0-100
    const bucket = totalAmount.mul(ownership);
    const outstanding = prefOutstanding.get(p.id) ?? ZERO;
    const paid = Decimal.min(bucket, outstanding);
    prefAllocated.set(p.id, paid);
  }

  const totalPrefPaid = sum([...prefAllocated.values()]);
  let remaining = totalAmount.minus(totalPrefPaid);
  if (remaining.lt(0)) remaining = ZERO;

  // ---- Step 5: split remaining between LP class and GP class, then pro-rata
  // within each class by ownership_pct.
  const lpPositions = positions.filter(
    (p) => p.shareClass === "class_a" || p.shareClass === "class_b"
  );
  const gpPositions = positions.filter((p) => p.shareClass === "gp");

  const lpOwnershipSum = sum(lpPositions.map((p) => D(p.ownershipPct)));
  const gpOwnershipSum = sum(gpPositions.map((p) => D(p.ownershipPct)));

  const lpPortion = remaining.mul(lpSplit).div(100);
  const gpPortion = remaining.mul(gpSplit).div(100);

  const splitAllocated = new Map<string, Decimal>();

  if (lpOwnershipSum.gt(0)) {
    for (const p of lpPositions) {
      splitAllocated.set(p.id, lpPortion.mul(D(p.ownershipPct)).div(lpOwnershipSum));
    }
  }
  if (gpOwnershipSum.gt(0)) {
    for (const p of gpPositions) {
      splitAllocated.set(p.id, gpPortion.mul(D(p.ownershipPct)).div(gpOwnershipSum));
    }
  }
  for (const p of positions) {
    if (!splitAllocated.has(p.id)) splitAllocated.set(p.id, ZERO);
  }

  // ---- Step 6: shape into line items. Route post-pref allocation into
  // return_of_capital vs profit_split based on distributionType.
  const isROC = distributionType === "return_of_capital";

  const rawDrafts: Array<{ p: Position; pref: Decimal; roc: Decimal; profit: Decimal }> = positions.map(
    (p) => {
      const pref = prefAllocated.get(p.id) ?? ZERO;
      const splitAmt = splitAllocated.get(p.id) ?? ZERO;
      return {
        p,
        pref,
        roc: isROC ? splitAmt : ZERO,
        profit: isROC ? ZERO : splitAmt,
      };
    }
  );

  // ---- Rounding reconciliation.
  //
  // The sum of line items must equal the *line-item target* — which is NOT
  // always `totalAmount`. If no GP positions exist, the GP's profit share
  // is implicit (operator take, off-ledger from the LP line items), and
  // `totalAmount` exceeds the sum of LP line items by exactly `gpPortion`.
  // Compute the expected line-item total from the underlying buckets and
  // reconcile to that target.
  const rounded = rawDrafts.map((d) => ({
    p: d.p,
    pref: D(toMoney(d.pref)),
    roc: D(toMoney(d.roc)),
    profit: D(toMoney(d.profit)),
  }));

  const lineItemTarget = totalPrefPaid
    .plus(lpOwnershipSum.gt(0) ? lpPortion : ZERO)
    .plus(gpOwnershipSum.gt(0) ? gpPortion : ZERO);

  const grossSum = sum(rounded.map((d) => d.pref.plus(d.roc).plus(d.profit)));
  const drift = lineItemTarget.minus(grossSum);

  if (!drift.eq(0) && rounded.length > 0) {
    // Apply drift to whichever component the largest line item received most
    // of, so the line stays internally sensible (don't bump `pref` if the
    // line is a pure profit_split, etc.).
    let target = rounded[0];
    let targetGross = target.pref.plus(target.roc).plus(target.profit);
    for (const r of rounded) {
      const g = r.pref.plus(r.roc).plus(r.profit);
      if (g.gt(targetGross)) {
        target = r;
        targetGross = g;
      }
    }
    // Prefer to adjust profit_split; if zero, try ROC; else pref.
    if (target.profit.gt(0) || !isROC) {
      target.profit = target.profit.plus(drift);
    } else if (target.roc.gt(0) || isROC) {
      target.roc = target.roc.plus(drift);
    } else {
      target.pref = target.pref.plus(drift);
    }
  }

  return rounded.map(({ p, pref, roc, profit }) => {
    const gross = pref.plus(roc).plus(profit);
    return {
      positionId: p.id,
      investorId: p.investorId,
      grossAmount: toMoney(gross),
      prefComponent: toMoney(pref),
      returnOfCapital: toMoney(roc),
      profitSplit: toMoney(profit),
      netAmount: toMoney(gross), // no withholding at MVP; net == gross
    };
  });
}

function sum(values: Decimal[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), ZERO);
}

function emptyDraft(p: Position): DistributionLineItemDraft {
  return {
    positionId: p.id,
    investorId: p.investorId,
    grossAmount: "0.00",
    prefComponent: "0.00",
    returnOfCapital: "0.00",
    profitSplit: "0.00",
    netAmount: "0.00",
  };
}
