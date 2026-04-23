import { eq, desc, sql } from "drizzle-orm";
import { db } from "@db";
import {
  deals,
  positions,
  waterfallConfigs,
  distributions,
  capitalCalls,
  documents,
  tasks,
  communications,
  investors,
  type Deal,
  type NewDeal,
  type Position,
} from "@shared/schema";
import { writeAudit, type AuditContext } from "./audit";

export type { Deal };

export async function listDeals(): Promise<Deal[]> {
  return db.select().from(deals).orderBy(desc(deals.createdAt));
}

export async function getDealById(id: string): Promise<Deal | null> {
  const [row] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  return row ?? null;
}

export async function createDeal(
  input: Omit<NewDeal, "id" | "createdAt" | "equityRaised"> & { equityRaised?: string },
  ctx: AuditContext
): Promise<Deal> {
  const [row] = await db
    .insert(deals)
    .values({ ...input, equityRaised: input.equityRaised ?? "0" })
    .returning();
  await writeAudit(ctx, {
    tableName: "deals",
    recordId: row.id,
    action: "INSERT",
    newValues: row,
  });
  return row;
}

export async function updateDeal(
  id: string,
  patch: Partial<NewDeal>,
  ctx: AuditContext
): Promise<Deal | null> {
  const [existing] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  if (!existing) return null;
  const [row] = await db.update(deals).set(patch).where(eq(deals.id, id)).returning();
  await writeAudit(ctx, {
    tableName: "deals",
    recordId: id,
    action: "UPDATE",
    oldValues: existing,
    newValues: row,
  });
  return row;
}

export async function deleteDeal(id: string, ctx: AuditContext): Promise<boolean> {
  const [existing] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  if (!existing) return false;
  await db.delete(deals).where(eq(deals.id, id));
  await writeAudit(ctx, {
    tableName: "deals",
    recordId: id,
    action: "DELETE",
    oldValues: existing,
  });
  return true;
}

/** Expanded deal shape used by the Detail page. */
export async function getDealDetail(id: string) {
  const deal = await getDealById(id);
  if (!deal) return null;

  const [dealPositions, [waterfall], dealDistributions, dealCalls, dealDocs, dealTasks, dealComms] =
    await Promise.all([
      db
        .select({
          position: positions,
          investorFullName: investors.fullName,
          investorEmail: investors.email,
          investorEntityName: investors.entityName,
        })
        .from(positions)
        .leftJoin(investors, eq(positions.investorId, investors.id))
        .where(eq(positions.dealId, id)),
      db.select().from(waterfallConfigs).where(eq(waterfallConfigs.dealId, id)).limit(1),
      db
        .select()
        .from(distributions)
        .where(eq(distributions.dealId, id))
        .orderBy(desc(distributions.distributionDate)),
      db
        .select()
        .from(capitalCalls)
        .where(eq(capitalCalls.dealId, id))
        .orderBy(desc(capitalCalls.callDate)),
      db
        .select()
        .from(documents)
        .where(eq(documents.dealId, id))
        .orderBy(desc(documents.uploadedAt)),
      db.select().from(tasks).where(eq(tasks.dealId, id)).orderBy(desc(tasks.createdAt)),
      db
        .select()
        .from(communications)
        .where(eq(communications.dealId, id))
        .orderBy(desc(communications.occurredAt))
        .limit(50),
    ]);

  return {
    deal,
    positions: dealPositions,
    waterfall: waterfall ?? null,
    distributions: dealDistributions,
    capitalCalls: dealCalls,
    documents: dealDocs,
    tasks: dealTasks,
    communications: dealComms,
  };
}

/** Portfolio summary numbers for the GP dashboard cards. */
export async function getPortfolioSummary() {
  const [stats] = await db
    .select({
      totalDeals: sql<number>`count(*)::int`,
      activeDeals: sql<number>`count(*) filter (where ${deals.status} = 'active')::int`,
      fundraisingDeals: sql<number>`count(*) filter (where ${deals.status} = 'fundraising')::int`,
      exitedDeals: sql<number>`count(*) filter (where ${deals.status} = 'exited')::int`,
      totalAssetValue: sql<string>`coalesce(sum(${deals.currentValue}), 0)::text`,
      totalLoanBalance: sql<string>`coalesce(sum(${deals.loanBalance}), 0)::text`,
      totalEquityRaised: sql<string>`coalesce(sum(${deals.equityRaised}), 0)::text`,
    })
    .from(deals);

  const [investorStats] = await db
    .select({ totalInvestors: sql<number>`count(*)::int` })
    .from(investors);

  const [distStats] = await db
    .select({
      totalDistributionsYtd: sql<string>`coalesce(sum(${distributions.totalAmount}) filter (where ${distributions.distributionDate} >= date_trunc('year', now())), 0)::text`,
    })
    .from(distributions)
    .where(sql`${distributions.status} = 'paid'`);

  return {
    totalDeals: stats?.totalDeals ?? 0,
    activeDeals: stats?.activeDeals ?? 0,
    fundraisingDeals: stats?.fundraisingDeals ?? 0,
    exitedDeals: stats?.exitedDeals ?? 0,
    totalAssetValue: stats?.totalAssetValue ?? "0",
    totalLoanBalance: stats?.totalLoanBalance ?? "0",
    totalEquityRaised: stats?.totalEquityRaised ?? "0",
    totalInvestors: investorStats?.totalInvestors ?? 0,
    totalDistributionsYtd: distStats?.totalDistributionsYtd ?? "0",
  };
}

// --- Positions -----------------------------------------------------------

export async function listPositionsByDeal(dealId: string): Promise<Position[]> {
  return db.select().from(positions).where(eq(positions.dealId, dealId));
}

export async function listPositionsByInvestor(investorId: string) {
  return db
    .select({
      position: positions,
      dealName: deals.name,
      dealStatus: deals.status,
    })
    .from(positions)
    .leftJoin(deals, eq(positions.dealId, deals.id))
    .where(eq(positions.investorId, investorId));
}
