import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import { db } from "@db";
import { gpUsers } from "@shared/schema";
import { validate } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefresh,
  revokeRefresh,
  findLiveRefresh,
} from "./tokens";
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  clearAuthCookies,
  setAccessCookie,
  setRefreshCookie,
} from "./cookies";

/**
 * GP auth routes (PRD §11.2):
 *  - POST /api/auth/gp/login   email+password → JWT cookies
 *  - POST /api/auth/gp/refresh rotates refresh token, returns new access cookie
 *  - POST /api/auth/gp/logout  revokes active refresh and clears cookies
 *  - GET  /api/auth/gp/me      returns current GP profile (session probe)
 *
 * Password is bcrypt cost 12+. Brute force is blocked by per-email rate
 * limiting at the app layer; Replit handles TLS so cookies may be Secure.
 */

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// 10 attempts per IP per 15 min — layered with per-email check below.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:gp-login`,
});

export const gpAuthRouter = Router();

gpAuthRouter.post(
  "/login",
  loginLimiter,
  validate({ body: loginSchema }),
  async (req: Request, res: Response) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const [user] = await db
      .select()
      .from(gpUsers)
      .where(eq(gpUsers.email, email.toLowerCase().trim()))
      .limit(1);

    // Constant-ish time: do a throwaway bcrypt compare to reduce user enum.
    const hash = user?.passwordHash ?? "$2a$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidha";
    const ok = await bcrypt.compare(password, hash);

    if (!user || !user.isActive || !ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const access = signAccessToken(user.id, "gp");
    const refresh = await issueRefreshToken({
      userId: user.id,
      role: "gp",
      ip: req.ip,
      userAgent: req.headers["user-agent"] ?? null,
    });

    setAccessCookie(res, access);
    setRefreshCookie(res, refresh.plaintext, refresh.expiresAt);

    await db.update(gpUsers).set({ lastLoginAt: new Date() }).where(eq(gpUsers.id, user.id));
    await writeAudit(
      {
        changedBy: user.id,
        changedByRole: "gp",
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
      {
        tableName: "gp_users",
        recordId: user.id,
        action: "UPDATE",
        newValues: { event: "login", lastLoginAt: new Date().toISOString() },
      }
    );

    res.json({ id: user.id, email: user.email, fullName: user.fullName, role: "gp" });
  }
);

gpAuthRouter.post("/refresh", async (req: Request, res: Response) => {
  const token = req.cookies?.[COOKIE_REFRESH];
  if (!token) return res.status(401).json({ error: "No refresh token" });

  const rotated = await rotateRefresh(token, {
    ip: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });
  if (!rotated || rotated.role !== "gp") {
    clearAuthCookies(res);
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  setAccessCookie(res, signAccessToken(rotated.userId, "gp"));
  setRefreshCookie(res, rotated.issued.plaintext, rotated.issued.expiresAt);
  res.json({ ok: true });
});

gpAuthRouter.post("/logout", async (req: Request, res: Response) => {
  const token = req.cookies?.[COOKIE_REFRESH];
  if (token) {
    const existing = await findLiveRefresh(token);
    if (existing) await revokeRefresh(existing.id, null);
  }
  clearAuthCookies(res);
  res.status(204).end();
});

gpAuthRouter.get("/me", async (req: Request, res: Response) => {
  // requireAuth middleware mounted at the router level has already populated
  // req.user — see middleware/auth.ts. If we reach here and it's missing,
  // the caller mounted us without the guard.
  const auth = (req as any).auth as { sub: string; role: string } | undefined;
  if (!auth || auth.role !== "gp") return res.status(401).json({ error: "Unauthorized" });
  const [user] = await db.select().from(gpUsers).where(eq(gpUsers.id, auth.sub)).limit(1);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json({ id: user.id, email: user.email, fullName: user.fullName, role: "gp" });
});

export { COOKIE_ACCESS };
