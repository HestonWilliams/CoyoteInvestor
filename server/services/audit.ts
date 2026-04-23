import { auditLog, type AuditLogEntry } from "@shared/schema";
import { db } from "@db";

/**
 * Audit log writer (PRD §11.4). All mutations flow through the service layer
 * and call into this helper; the app DB user should have INSERT-only grants
 * on the audit_log table so tampering is physically impossible.
 *
 * IMPORTANT: never include decrypted secrets in oldValues / newValues. The
 * service-layer callers below pass ciphertexts only for encrypted columns.
 */

export interface AuditContext {
  changedBy?: string | null;
  changedByRole: "gp" | "lp" | "system" | "gmail_sync";
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditPayload {
  tableName: string;
  recordId: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}

export async function writeAudit(
  ctx: AuditContext,
  payload: AuditPayload
): Promise<void> {
  const entry: AuditLogEntry = {
    tableName: payload.tableName,
    recordId: payload.recordId,
    action: payload.action,
    changedBy: ctx.changedBy ?? null,
    changedByRole: ctx.changedByRole,
    oldValues: payload.oldValues ?? null,
    newValues: payload.newValues ?? null,
    ipAddress: ctx.ipAddress ?? null,
    userAgent: ctx.userAgent ?? null,
  };
  try {
    await db.insert(auditLog).values(entry);
  } catch (err) {
    // Audit failures must not bring down user operations, but they must be
    // loud — failure to audit is a compliance event.
    console.error("[AUDIT] failed to write entry", { payload, err });
  }
}
