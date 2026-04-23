import { eq } from "drizzle-orm";
import { db } from "@db";
import { gmailSyncConfig, type GmailSyncConfig } from "@shared/schema";
import { encrypt, decrypt } from "../lib/crypto";
import { writeAudit, type AuditContext } from "./audit";

/**
 * Gmail sync config — access and refresh tokens are AES-256-GCM encrypted
 * (PRD §5.8 / §11.1). Callers only ever see decrypted tokens via the view.
 */

export interface GmailConfigView {
  id: string;
  gpUserId: string;
  gpEmail: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date | null;
  scope: string | null;
  lastSyncAt: Date | null;
  syncErrors: string[];
}

function toView(row: GmailSyncConfig): GmailConfigView {
  const accessToken = decrypt(row.accessTokenEnc);
  const refreshToken = decrypt(row.refreshTokenEnc);
  if (!accessToken || !refreshToken) {
    throw new Error("Corrupted gmail_sync_config tokens");
  }
  return {
    id: row.id,
    gpUserId: row.gpUserId,
    gpEmail: row.gpEmail,
    accessToken,
    refreshToken,
    tokenExpiry: row.tokenExpiry,
    scope: row.scope,
    lastSyncAt: row.lastSyncAt,
    syncErrors: row.syncErrors,
  };
}

export async function getGmailConfig(gpUserId: string): Promise<GmailConfigView | null> {
  const [row] = await db
    .select()
    .from(gmailSyncConfig)
    .where(eq(gmailSyncConfig.gpUserId, gpUserId))
    .limit(1);
  return row ? toView(row) : null;
}

export async function getActiveGmailConfig(): Promise<GmailConfigView | null> {
  const [row] = await db.select().from(gmailSyncConfig).limit(1);
  return row ? toView(row) : null;
}

export async function upsertGmailConfig(
  params: {
    gpUserId: string;
    gpEmail: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiry: Date | null;
    scope?: string | null;
  },
  ctx: AuditContext
): Promise<GmailConfigView> {
  const encAccess = encrypt(params.accessToken);
  const encRefresh = encrypt(params.refreshToken);
  if (!encAccess || !encRefresh) throw new Error("Encryption produced null");

  const existing = await getGmailConfig(params.gpUserId);
  if (existing) {
    const [row] = await db
      .update(gmailSyncConfig)
      .set({
        gpEmail: params.gpEmail,
        accessTokenEnc: encAccess,
        refreshTokenEnc: encRefresh,
        tokenExpiry: params.tokenExpiry,
        scope: params.scope ?? null,
      })
      .where(eq(gmailSyncConfig.gpUserId, params.gpUserId))
      .returning();
    await writeAudit(ctx, {
      tableName: "gmail_sync_config",
      recordId: row.id,
      action: "UPDATE",
      newValues: { gpEmail: row.gpEmail, tokenExpiry: row.tokenExpiry, scope: row.scope },
    });
    return toView(row);
  }

  const [row] = await db
    .insert(gmailSyncConfig)
    .values({
      gpUserId: params.gpUserId,
      gpEmail: params.gpEmail,
      accessTokenEnc: encAccess,
      refreshTokenEnc: encRefresh,
      tokenExpiry: params.tokenExpiry,
      scope: params.scope ?? null,
    })
    .returning();
  await writeAudit(ctx, {
    tableName: "gmail_sync_config",
    recordId: row.id,
    action: "INSERT",
    newValues: { gpEmail: row.gpEmail, scope: row.scope },
  });
  return toView(row);
}

export async function recordSyncSuccess(configId: string, when: Date): Promise<void> {
  await db
    .update(gmailSyncConfig)
    .set({ lastSyncAt: when, syncErrors: [] })
    .where(eq(gmailSyncConfig.id, configId));
}

export async function recordSyncError(configId: string, message: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(gmailSyncConfig)
    .where(eq(gmailSyncConfig.id, configId))
    .limit(1);
  if (!existing) return;
  const errors = [message, ...existing.syncErrors].slice(0, 10);
  await db
    .update(gmailSyncConfig)
    .set({ syncErrors: errors })
    .where(eq(gmailSyncConfig.id, configId));
}

export async function updateAccessToken(
  configId: string,
  accessToken: string,
  tokenExpiry: Date | null
): Promise<void> {
  const enc = encrypt(accessToken);
  if (!enc) throw new Error("Encryption produced null");
  await db
    .update(gmailSyncConfig)
    .set({ accessTokenEnc: enc, tokenExpiry })
    .where(eq(gmailSyncConfig.id, configId));
}
