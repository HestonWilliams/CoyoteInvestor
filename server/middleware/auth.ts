import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type UserRole } from "../auth/tokens";
import { COOKIE_ACCESS } from "../auth/cookies";

export interface AuthedRequest extends Request {
  auth?: { sub: string; role: UserRole };
}

/**
 * Deny-by-default auth guard. Reads the access token from the httpOnly
 * cookie only — no Authorization header fallback, so XSS cannot re-use
 * stolen tokens from JS-accessible stores (there are none).
 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_ACCESS];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const claims = verifyAccessToken(token);
    if (!claims?.sub || !claims?.role) throw new Error("missing claims");
    req.auth = { sub: claims.sub as string, role: claims.role as UserRole };
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.auth.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

/**
 * LP scope: derives investor_id from JWT sub and pins it onto
 * req.scopedInvestorId. Routes that touch LP data MUST read from here —
 * never trust an investor_id param from the body/query (PRD §11.3).
 */
export function scopeToInvestor(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth || req.auth.role !== "lp") return res.status(403).json({ error: "Forbidden" });
  (req as any).scopedInvestorId = req.auth.sub;
  next();
}
