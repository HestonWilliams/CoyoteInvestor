import { eq, desc, sql } from "drizzle-orm";
import { db } from "@db";
import {
  communications,
  investors,
  type NewCommunication,
  type Communication,
} from "@shared/schema";
import { writeAudit, type AuditContext } from "./audit";

/**
 * Inserts an email log, deduplicating on gmail_message_id (UNIQUE constraint
 * + ON CONFLICT DO NOTHING). Returns whether the row was new.
 */
export async function ingestEmail(
  data: Omit<NewCommunication, "id" | "createdAt" | "channel"> & {
    channel?: string;
    gmailMessageId?: string | null;
  },
  ctx: AuditContext
): Promise<{ inserted: boolean; id: string | null }> {
  const values: NewCommunication = {
    investorId: data.investorId ?? null,
    dealId: data.dealId ?? null,
    channel: data.channel ?? "email",
    subject: data.subject ?? null,
    body: data.body ?? null,
    direction: data.direction ?? null,
    occurredAt: data.occurredAt ?? new Date(),
    loggedBy: data.loggedBy ?? "system",
    gmailMessageId: data.gmailMessageId ?? null,
    gmailThreadId: data.gmailThreadId ?? null,
  };

  if (values.gmailMessageId) {
    const inserted = await db
      .insert(communications)
      .values(values)
      .onConflictDoNothing({ target: communications.gmailMessageId })
      .returning({ id: communications.id });
    if (inserted.length === 0) return { inserted: false, id: null };
    await writeAudit(ctx, {
      tableName: "communications",
      recordId: inserted[0].id,
      action: "INSERT",
      newValues: {
        investorId: values.investorId,
        loggedBy: values.loggedBy,
        direction: values.direction,
      },
    });
    return { inserted: true, id: inserted[0].id };
  }

  const [row] = await db.insert(communications).values(values).returning({ id: communications.id });
  await writeAudit(ctx, {
    tableName: "communications",
    recordId: row.id,
    action: "INSERT",
    newValues: {
      investorId: values.investorId,
      loggedBy: values.loggedBy,
      direction: values.direction,
    },
  });
  return { inserted: true, id: row.id };
}

export async function listCommunicationsByInvestor(
  investorId: string,
  limit = 50
): Promise<Communication[]> {
  return db
    .select()
    .from(communications)
    .where(eq(communications.investorId, investorId))
    .orderBy(desc(communications.occurredAt))
    .limit(limit);
}

export async function findInvestorByAnyEmail(
  emails: string[]
): Promise<{ id: string; email: string } | null> {
  if (emails.length === 0) return null;
  const normalized = emails.map((e) => e.toLowerCase().trim()).filter(Boolean);
  const [row] = await db
    .select({ id: investors.id, email: investors.email })
    .from(investors)
    .where(sql`lower(${investors.email}) = ANY(${normalized})`)
    .limit(1);
  return row ?? null;
}
