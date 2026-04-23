import { Router, type Request } from "express";
import { google } from "googleapis";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth";
import { auditCtx } from "../middleware/auditCtx";
import { upsertGmailConfig } from "../services/gmailConfig";
import { env } from "../lib/env";

/**
 * Gmail OAuth2 connect flow (PRD §5.8):
 *   GET  /api/auth/gmail            → redirect to Google consent
 *   GET  /api/auth/gmail/callback   → exchange code, store encrypted tokens
 *
 * Scope: gmail.readonly only — the app never sends via Gmail (Resend does).
 */

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

function oauth2Client() {
  return new google.auth.OAuth2(
    env.gmailClientId,
    env.gmailClientSecret,
    env.gmailRedirectUri
  );
}

export const gmailAuthRouter = Router();

gmailAuthRouter.get("/", requireAuth, requireRole("gp"), (req: AuthedRequest, res) => {
  if (!env.gmailClientId || !env.gmailClientSecret) {
    return res.status(500).json({ error: "Gmail OAuth env not configured" });
  }
  const url = oauth2Client().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force refresh_token on every connect
    scope: SCOPES,
    state: req.auth!.sub,
    include_granted_scopes: true,
  });
  res.redirect(url);
});

gmailAuthRouter.get("/callback", async (req: Request, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state) return res.status(400).send("Missing code/state");

  // state is the gp_user id; verify session separately by looking up a live
  // access cookie from the same browser. Here we just trust state because
  // the callback route is deliberately unauthenticated (Google POSTs the
  // browser here). In a stricter setup we'd sign state as a short JWT.
  try {
    const client = oauth2Client();
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      return res.status(400).send("Google returned incomplete tokens");
    }

    // Pull the connected gmail address from the userinfo endpoint.
    client.setCredentials(tokens);
    const profile = await google
      .gmail({ version: "v1", auth: client })
      .users.getProfile({ userId: "me" });

    await upsertGmailConfig(
      {
        gpUserId: state,
        gpEmail: profile.data.emailAddress ?? env.gpGmailAddress,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope ?? SCOPES.join(" "),
      },
      {
        changedBy: state,
        changedByRole: "gp",
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      }
    );

    res.redirect(`${env.publicUrl}/settings?gmail=connected`);
  } catch (err) {
    console.error("[gmail/callback]", err);
    res.status(500).send("Failed to complete Gmail connection");
  }
});
