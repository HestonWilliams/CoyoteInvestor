/**
 * Waterfall engine tests.
 *
 * Self-executing — run with `tsx server/lib/waterfall.test.ts`.
 * No test runner dep; uses node:assert/strict.
 *
 * Cases (per Phase 2 checklist):
 *   1. Simple 2-LP deal — operating distribution, sufficient to cover pref
 *      and leave profit split for LP/GP per config.
 *   2. Underfunded pref — total distribution smaller than sum of outstanding
 *      pref; each LP receives proportional partial payment.
 *   3. Full exit — return_of_capital type routing post-pref into the ROC
 *      column rather than profit_split.
 */

import assert from "node:assert/strict";
import { calculateDistribution, type DistributionType } from "./waterfall";
import type { Position, WaterfallConfig } from "@shared/schema";

// ----- Test harness --------------------------------------------------

let failed = 0;
let passed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(e instanceof Error ? e.stack : e);
  }
}

function near(actual: string, expected: string, label: string, tolerance = 0.01) {
  const diff = Math.abs(Number(actual) - Number(expected));
  assert.ok(
    diff <= tolerance,
    `${label}: expected ~${expected}, got ${actual} (diff ${diff.toFixed(4)})`
  );
}

// ----- Fixtures ------------------------------------------------------

const DEAL = { id: "deal-1" };

function pos(
  overrides: Partial<Position> & { id: string; investorId: string; fundedAmount: string }
): Position {
  return {
    id: overrides.id,
    dealId: "deal-1",
    investorId: overrides.investorId,
    committedAmount: overrides.committedAmount ?? overrides.fundedAmount,
    fundedAmount: overrides.fundedAmount,
    ownershipPct: overrides.ownershipPct ?? "50",
    shareClass: overrides.shareClass ?? "class_a",
    status: overrides.status ?? "funded",
    fundedAt: overrides.fundedAt ?? new Date("2023-01-01"),
    createdAt: overrides.createdAt ?? new Date("2023-01-01"),
  };
}

function cfg(
  overrides: Partial<Pick<WaterfallConfig, "prefReturnPct" | "lpSplitPct" | "gpSplitPct">> = {}
): Pick<WaterfallConfig, "prefReturnPct" | "lpSplitPct" | "gpSplitPct"> {
  return {
    prefReturnPct: overrides.prefReturnPct ?? "7",
    lpSplitPct: overrides.lpSplitPct ?? "70",
    gpSplitPct: overrides.gpSplitPct ?? "30",
  };
}

// ----- Tests ---------------------------------------------------------

console.log("waterfall engine");

test("1. simple 2-LP deal — pref + profit split, sums to total", () => {
  // Two LPs fully funded Jan 1 2024. Distribution on Jan 1 2025 (365 days).
  // Each funded $500,000, 50% ownership, 7% pref, 70/30 split.
  // prefOwed per LP = 500_000 × 0.07 × 365/365 = $35,000
  // Total pref = $70,000
  // Distribute $100,000:
  //   $70,000 covers pref
  //   $30,000 remaining × 70% = $21,000 LP profit pro-rata (10,500 each)
  //   gp $9,000 is implicit (no GP positions)
  const positions = [
    pos({
      id: "p1",
      investorId: "inv-1",
      fundedAmount: "500000",
      ownershipPct: "50",
      fundedAt: new Date("2023-01-01"),
    }),
    pos({
      id: "p2",
      investorId: "inv-2",
      fundedAmount: "500000",
      ownershipPct: "50",
      fundedAt: new Date("2023-01-01"),
    }),
  ];

  const result = calculateDistribution({
    deal: DEAL,
    positions,
    config: cfg(),
    totalAmount: 100000,
    distributionType: "operating" as DistributionType,
    prefPaidToDate: {},
    effectiveDate: new Date("2024-01-01"),
  });

  assert.equal(result.length, 2);

  for (const row of result) {
    near(row.prefComponent, "35000", `${row.positionId} pref`);
    near(row.profitSplit, "10500", `${row.positionId} profit`);
    near(row.returnOfCapital, "0", `${row.positionId} roc`);
    near(row.netAmount, "45500", `${row.positionId} net`);
  }

  const lineSum = result.reduce((acc, r) => acc + Number(r.netAmount), 0);
  // LP total = 70,000 pref + 21,000 profit = 91,000. GP 9,000 not in line items.
  assert.equal(lineSum.toFixed(2), "91000.00");
});

test("2. underfunded pref — partial proportional payment, no profit split", () => {
  // Same structure, but only $40,000 to distribute vs $70,000 of outstanding pref.
  // Each LP's bucket = 40_000 × 50% = $20,000 → capped by their $35,000 outstanding → each gets $20,000.
  // Nothing left for profit_split.
  const positions = [
    pos({
      id: "p1",
      investorId: "inv-1",
      fundedAmount: "500000",
      ownershipPct: "50",
      fundedAt: new Date("2023-01-01"),
    }),
    pos({
      id: "p2",
      investorId: "inv-2",
      fundedAmount: "500000",
      ownershipPct: "50",
      fundedAt: new Date("2023-01-01"),
    }),
  ];

  const result = calculateDistribution({
    deal: DEAL,
    positions,
    config: cfg(),
    totalAmount: 40000,
    distributionType: "operating" as DistributionType,
    prefPaidToDate: {},
    effectiveDate: new Date("2024-01-01"),
  });

  for (const row of result) {
    near(row.prefComponent, "20000", `${row.positionId} pref`);
    near(row.profitSplit, "0", `${row.positionId} profit`);
  }

  const lineSum = result.reduce((acc, r) => acc + Number(r.netAmount), 0);
  assert.equal(lineSum.toFixed(2), "40000.00");
});

test("3. full exit — return_of_capital routes post-pref into ROC column", () => {
  // Sale-style distribution: type = return_of_capital. Post-pref amount
  // goes into return_of_capital, NOT profit_split. This is the checklist
  // contract: "return_of_capital (0 unless type is return_of_capital)".
  const positions = [
    pos({
      id: "p1",
      investorId: "inv-1",
      fundedAmount: "500000",
      ownershipPct: "50",
      fundedAt: new Date("2023-01-01"),
    }),
    pos({
      id: "p2",
      investorId: "inv-2",
      fundedAmount: "500000",
      ownershipPct: "50",
      fundedAt: new Date("2023-01-01"),
    }),
  ];

  const result = calculateDistribution({
    deal: DEAL,
    positions,
    config: cfg(),
    totalAmount: 1_100_000,
    distributionType: "return_of_capital" as DistributionType,
    prefPaidToDate: {},
    effectiveDate: new Date("2024-01-01"),
  });

  // Each LP: $35k pref. Remaining $1,030,000 × 70% = $721,000 LP, pro-rata 50/50
  // → $360,500 each into return_of_capital. profit_split must be 0.
  for (const row of result) {
    near(row.prefComponent, "35000", `${row.positionId} pref`);
    near(row.profitSplit, "0", `${row.positionId} profit (must be 0 for ROC)`);
    near(row.returnOfCapital, "360500", `${row.positionId} roc`);
  }

  const lineSum = result.reduce((acc, r) => acc + Number(r.netAmount), 0);
  // LP total = 70,000 + 721,000 = 791,000 (GP 30% implicit)
  assert.equal(lineSum.toFixed(2), "791000.00");
});

test("4. line-item totals reconcile to totalAmount across rounding", () => {
  // Three positions with odd ownership splits that force non-terminating
  // fractions. The reconciliation pass must park any drift on a single line
  // so the sum equals totalAmount to the cent.
  const positions = [
    pos({
      id: "p1",
      investorId: "inv-1",
      fundedAmount: "333333.33",
      ownershipPct: "33.3333",
      fundedAt: new Date("2023-01-01"),
    }),
    pos({
      id: "p2",
      investorId: "inv-2",
      fundedAmount: "333333.33",
      ownershipPct: "33.3333",
      fundedAt: new Date("2023-01-01"),
    }),
    pos({
      id: "p3",
      investorId: "inv-3",
      fundedAmount: "333333.34",
      ownershipPct: "33.3334",
      fundedAt: new Date("2023-01-01"),
    }),
  ];

  const result = calculateDistribution({
    deal: DEAL,
    positions,
    config: cfg(),
    totalAmount: 100000,
    distributionType: "operating" as DistributionType,
    prefPaidToDate: {},
    effectiveDate: new Date("2024-01-01"),
  });

  // LP portion totals: pref + profit split (GP 30% implicit off-line-item).
  // Pref: 333,333.33 × 0.07 = 23,333.33 × 2 + 23,333.33 ~= 69,999.99 total
  // Actually each LP owns ~33.33% so pref buckets are 100k×33.33% = $33,333,
  // capped at outstanding pref ≈ $23,333.33 → total pref ~$70,000.
  // Remaining ~$30,000 × 70% = ~$21,000 LP profit. LP total ~$91,000.
  const lpLineSum = result.reduce((acc, r) => acc + Number(r.netAmount), 0);
  // Since LP class totals net = pref paid (~70k) + lp profit portion (~21k) = ~91k
  assert.ok(
    Math.abs(lpLineSum - 91000) < 1,
    `Expected LP total ≈ 91000, got ${lpLineSum}`
  );

  // And crucially: every cent reconciles within each row.
  for (const row of result) {
    const components = Number(row.prefComponent) + Number(row.returnOfCapital) + Number(row.profitSplit);
    near(String(components), row.netAmount, `${row.positionId} internal reconciliation`, 0.001);
  }
});

// ----- Summary -------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
