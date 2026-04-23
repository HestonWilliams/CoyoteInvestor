import type { Response } from "express";
import { env } from "../lib/env";

/**
 * Cookie helpers. All auth cookies are httpOnly, SameSite=Lax (Strict in
 * prod for the refresh cookie since it only needs to be sent on same-site
 * /api/auth/refresh POSTs).
 */

const baseOpts = {
  httpOnly: true as const,
  secure: env.cookieSecure,
  domain: env.cookieDomain || undefined,
  path: "/",
};

export const COOKIE_ACCESS = "ce_access";
export const COOKIE_REFRESH = "ce_refresh";

export function setAccessCookie(res: Response, token: string): void {
  res.cookie(COOKIE_ACCESS, token, {
    ...baseOpts,
    sameSite: "lax",
    maxAge: 15 * 60 * 1000, // 15 min
  });
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(COOKIE_REFRESH, token, {
    ...baseOpts,
    // Limit refresh cookie scope so CSRF surface is only the refresh endpoint.
    path: "/api/auth",
    sameSite: env.isProd ? "strict" : "lax",
    expires: expiresAt,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(COOKIE_ACCESS, { ...baseOpts, sameSite: "lax" });
  res.clearCookie(COOKIE_REFRESH, {
    ...baseOpts,
    path: "/api/auth",
    sameSite: env.isProd ? "strict" : "lax",
  });
}
