import type { Response, NextFunction } from "express";
import type { AuditContext } from "../services/audit";
import type { AuthedRequest } from "./auth";

/**
 * Extracts the audit context from req.auth + headers. Routes call
 * `auditCtx(req)` inside their handler after `requireAuth` has populated
 * req.auth, and hand the resulting AuditContext to service functions.
 */
export function auditCtx(req: AuthedRequest): AuditContext {
  return {
    changedBy: req.auth?.sub ?? null,
    changedByRole: (req.auth?.role as "gp" | "lp" | undefined) ?? "system",
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  };
}
