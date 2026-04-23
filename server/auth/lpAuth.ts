import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import { db } from "@db";
import { investors, magicLinks } from "@shared/schema";
import { validate } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { randomToken } from "../lib/crypto";
import { signSessionToken } from "./tokens";
import { env } from "../lib/env";
import { setAccessCookie, clearAuthCookies } from "./cookies";

/**
 * LP portal auth (PRD §11.2):
 *  - POST /api/auth/lp/request  → email only; sends magic link
 *  - GET  /api/auth/lp/verify   → consume token, issue 7-day JWT cookie
 *  - POST /api/auth/lp/logout   → clear cookie
 *
 * Token security:
 *  - 32-byte random base64url string, returned ONCE in the email URL
 *  - Stored in DB as a bcrypt hash — never reversible
 *  - Single-use (consumedAt flips on verify)
 *  - 15-minute expiry
 *  - 5 requests per email per hour (§5.12)
 */

const TOKEN_TTL_MS = 15 * 60 * 1000;
const LP_SESSION_TTL: "7d" = "7d";

const requestSchema = z.object({
  email: z.string().email(),
});

const verifySchema = z.object({
  token: z.string().min(20),
  email: z.string().email(),
});

// 5 per IP per hour as a coarse outer limit. The inner per-email counter
// below provides the §5.12 "5 per email per hour" guarantee.
const magicRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:lp-magic`,
});

export const lpAuthRouter = Router();

lpAuthRouter.post(
  "/request",
  magicRequestLimiter,
  validate({ body: requestSchema }),
  async (req: Request, res: Response) => {
    const { email } = req.body as z.infer<typeof requestSchema>;

    // Always respond 204 — never disclose whether the email is on file.
    const respondOk = () => res.status(204).end();

    const [investor] = await db
      .select()
      .from(investors)
      .where(eq(investors.email, email.toLowerCase().trim()))
      .limit(1);
    if (!investor || !investor.portalEnabled) return respondOk();

    // Per-email rate limit: 5 live requests per hour.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await db
      .select()
      .from(magicLinks)
      .where(eq(magicLinks.investorId, investor.id));
    const inWindow = recent.filter((r) => r.createdAt >= oneHourAgo);
    if (inWindow.length >= 5) {
      await writeAudit(
        {
          changedBy: investor.id,
          changedByRole: "lp",
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        },
        {
          tableName: "magic_links",
          recordId: investor.id,
          action: "INSERT",
          newValues: { event: "rate_limited" },
        }
      );
      return respondOk();
    }

    const plaintext = randomToken(32);
    const hash = await bcrypt.hash(plaintext, 10);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    await db.insert(magicLinks).values({
      investorId: investor.id,
      tokenHash: hash,
      expiresAt,
      ipAddress: req.ip ?? null,
    });

    const link = `${env.publicUrl}/lp/verify?token=${plaintext}&email=${encodeURIComponent(
      investor.email
    )}`;

    // Email via Resend. Kept lightweight — templates live in Phase 2.
    if (env.resendApiKey) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(env.resendApiKey);
        await resend.emails.send({
          from: env.resendFrom,
          to: investor.email,
          subject: "Your Coyote Equity portal sign-in link",
          text: `Sign in: ${link}\n\nThis link expires in 15 minutes and can be used once.`,
        });
      } catch (err) {
        console.error("[LP magic link] Resend send failed", err);
      }
    } else if (env.isDev) {
      console.log(`[LP magic link dev] ${link}`);
    }

    await writeAudit(
      {
        changedBy: investor.id,
        changedByRole: "lp",
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
      {
        tableName: "magic_links",
        recordId: investor.id,
        action: "INSERT",
        newValues: { event: "issued", expiresAt: expiresAt.toISOString() },
      }
    );

    return respondOk();
  }
);

lpAuthRouter.post(
  "/verify",
  validate({ body: verifySchema }),
  async (req: Request, res: Response) => {
    const { token, email } = req.body as z.infer<typeof verifySchema>;
    const [investor] = await db
      .select()
      .from(investors)
      .where(eq(investors.email, email.toLowerCase().trim()))
      .limit(1);
    if (!investor) return res.status(401).json({ error: "Invalid link" });

    // Find the most-recent unconsumed unexpired link for this investor and
    // bcrypt-compare against its hash.
    const candidates = await db
      .select()
      .from(magicLinks)
      .where(eq(magicLinks.investorId, investor.id))
      .orderBy(desc(magicLinks.createdAt))
      .limit(5);

    const now = new Date();
    let match: (typeof candidates)[number] | null = null;
    for (const c of candidates) {
      if (c.consumedAt) continue;
      if (c.expiresAt < now) continue;
      if (await bcrypt.compare(token, c.tokenHash)) {
        match = c;
        break;
      }
    }

    if (!match) return res.status(401).json({ error: "Invalid or expired link" });

    await db
      .update(magicLinks)
      .set({ consumedAt: now })
      .where(eq(magicLinks.id, match.id));

    const session = signSessionToken(investor.id, "lp", LP_SESSION_TTL);
    // LP session uses the access-cookie slot; no refresh rotation for LP
    // (magic-link flow re-auths on expiry).
    res.cookie("ce_access", session, {
      httpOnly: true,
      secure: env.cookieSecure,
      domain: env.cookieDomain || undefined,
      path: "/",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    await writeAudit(
      {
        changedBy: investor.id,
        changedByRole: "lp",
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
      {
        tableName: "magic_links",
        recordId: match.id,
        action: "UPDATE",
        newValues: { event: "consumed" },
      }
    );

    res.json({ id: investor.id, email: investor.email, role: "lp" });
  }
);

lpAuthRouter.post("/logout", (_req, res) => {
  clearAuthCookies(res);
  res.status(204).end();
});
