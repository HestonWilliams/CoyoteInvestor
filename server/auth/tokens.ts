import jwt, { type SignOptions } from "jsonwebtoken";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@db";
import { refreshTokens } from "@shared/schema";
import { randomToken, sha256Hex } from "../lib/crypto";
import { env } from "../lib/env";

/**
 * JWT + DB-backed refresh token store (PRD §11.2).
 *
 *  access_token:   15-min JWT, signed with JWT_SECRET, carries { sub, role }
 *  refresh_token:  7-day random 48-byte token, stored in DB as sha256 hash.
 *                  Rotated on every use: old row is marked revoked, new row
 *                  inserted with replacedBy pointer so the chain is auditable.
 *
 * Both tokens are set as httpOnly cookies by the route handlers. Access
 * tokens live only in memory on the client (no localStorage) so XSS can't
 * lift them even if a CSP gap appears.
 */

export type UserRole = "gp" | "lp";

export interface AccessClaims {
  sub: string; // gp user id or investor id
  role: UserRole;
  iat?: number;
  exp?: number;
}

const ACCESS_TTL: SignOptions["expiresIn"] = "15m";
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signAccessToken(sub: string, role: UserRole): string {
  return jwt.sign({ sub, role }, env.jwtSecret(), { expiresIn: ACCESS_TTL });
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.jwtSecret()) as AccessClaims;
}

/**
 * Sign a scoped JWT with a custom TTL (used for LP session = 7d cookie).
 * Kept separate from access-token API so callers can't accidentally widen
 * the 15-min GP access scope.
 */
export function signSessionToken(
  sub: string,
  role: UserRole,
  expiresIn: SignOptions["expiresIn"]
): string {
  return jwt.sign({ sub, role }, env.jwtSecret(), { expiresIn });
}

// ------------------------------------------------------------------
// Refresh token family (DB-backed rotation + revocation)
// ------------------------------------------------------------------

export interface IssuedRefresh {
  rowId: string;
  plaintext: string;
  expiresAt: Date;
}

export async function issueRefreshToken(opts: {
  userId: string;
  role: UserRole;
  ip?: string | null;
  userAgent?: string | null;
  replacedBy?: string | null;
}): Promise<IssuedRefresh> {
  const plaintext = randomToken(48);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  const [row] = await db
    .insert(refreshTokens)
    .values({
      userId: opts.userId,
      userRole: opts.role,
      tokenHash: sha256Hex(plaintext),
      expiresAt,
      ipAddress: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
    })
    .returning();
  return { rowId: row.id, plaintext, expiresAt };
}

/**
 * Look up a live (non-revoked, non-expired) refresh row by plaintext.
 * Returns the DB row or null.
 */
export async function findLiveRefresh(plaintext: string) {
  const hash = sha256Hex(plaintext);
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tokenHash, hash),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date())
      )
    )
    .limit(1);
  return row ?? null;
}

export async function revokeRefresh(rowId: string, replacedBy: string | null): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), replacedBy: replacedBy })
    .where(eq(refreshTokens.id, rowId));
}

/**
 * Rotate: verify → revoke old → issue new. Returns new plaintext + expiry
 * or null if the supplied token is not live.
 */
export async function rotateRefresh(
  plaintext: string,
  ctx: { ip?: string | null; userAgent?: string | null }
): Promise<{ issued: IssuedRefresh; userId: string; role: UserRole } | null> {
  const existing = await findLiveRefresh(plaintext);
  if (!existing) return null;
  const issued = await issueRefreshToken({
    userId: existing.userId,
    role: existing.userRole as UserRole,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  await revokeRefresh(existing.id, issued.rowId);
  return { issued, userId: existing.userId, role: existing.userRole as UserRole };
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
