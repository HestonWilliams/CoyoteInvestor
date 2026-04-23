import cron from "node-cron";
import { google } from "googleapis";
import {
  getActiveGmailConfig,
  recordSyncSuccess,
  recordSyncError,
  updateAccessToken,
} from "../services/gmailConfig";
import { ingestEmail, findInvestorByAnyEmail } from "../services/communications";
import { env } from "../lib/env";

/**
 * Gmail sync job (PRD §5.8).
 *   - Runs every 15 minutes via node-cron.
 *   - Pulls messages from `newer_than:1h` to give ~45 min of overlap.
 *   - Iterates message-by-message and matches sender/recipient against
 *     investors.email (case-insensitive).
 *   - Inserts with onConflictDoNothing on gmail_message_id (UNIQUE), so
 *     re-runs are idempotent.
 *   - Never sends mail via Gmail — outbound is Resend only.
 */

let running = false;

function oauth2Client(access: string, refresh: string) {
  const client = new google.auth.OAuth2(env.gmailClientId, env.gmailClientSecret, env.gmailRedirectUri);
  client.setCredentials({ access_token: access, refresh_token: refresh });
  return client;
}

function headerValue(headers: Array<{ name?: string | null; value?: string | null }>, name: string) {
  const lower = name.toLowerCase();
  for (const h of headers) {
    if ((h.name ?? "").toLowerCase() === lower) return h.value ?? "";
  }
  return "";
}

function parseAddresses(header: string): string[] {
  // Pull bare email addresses out of a "Name <email>, Other <x@y>" list.
  return (header.match(/[\w.+\-]+@[\w.\-]+/g) ?? []).map((s) => s.toLowerCase());
}

function decodePart(data?: string | null): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

function extractPlainText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodePart(payload.body.data);
  }
  if (payload.parts?.length) {
    for (const p of payload.parts) {
      const t = extractPlainText(p);
      if (t) return t;
    }
  }
  if (payload.body?.data) return decodePart(payload.body.data);
  return "";
}

export async function runGmailSyncOnce(): Promise<{
  processed: number;
  inserted: number;
  skipped: number;
}> {
  const cfg = await getActiveGmailConfig();
  if (!cfg) return { processed: 0, inserted: 0, skipped: 0 };

  const auth = oauth2Client(cfg.accessToken, cfg.refreshToken);
  // Refresh access token if expired — googleapis normally handles this
  // transparently, but we persist the fresh token (encrypted) so subsequent
  // jobs don't re-refresh.
  auth.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      try {
        await updateAccessToken(
          cfg.id,
          tokens.access_token,
          tokens.expiry_date ? new Date(tokens.expiry_date) : null
        );
      } catch (err) {
        console.error("[gmail-sync] failed to persist refreshed token", err);
      }
    }
  });

  const gmail = google.gmail({ version: "v1", auth });

  let inserted = 0;
  let skipped = 0;
  let processed = 0;

  try {
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: "newer_than:1h",
      maxResults: 100,
    });
    const msgs = listRes.data.messages ?? [];

    for (const m of msgs) {
      if (!m.id) continue;
      processed++;
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: m.id,
        format: "full",
      });
      const headers = msg.data.payload?.headers ?? [];
      const from = headerValue(headers, "From");
      const to = headerValue(headers, "To");
      const cc = headerValue(headers, "Cc");
      const bcc = headerValue(headers, "Bcc");
      const subject = headerValue(headers, "Subject");
      const dateStr = headerValue(headers, "Date");

      const senderAddrs = parseAddresses(from);
      const recipientAddrs = parseAddresses(`${to},${cc},${bcc}`);
      const allAddrs = [...senderAddrs, ...recipientAddrs];

      // Any match against a known investor?
      const investor = await findInvestorByAnyEmail(allAddrs);
      if (!investor) {
        skipped++;
        continue;
      }

      const gpEmail = cfg.gpEmail.toLowerCase();
      const direction: "inbound" | "outbound" = senderAddrs.includes(gpEmail) ? "outbound" : "inbound";
      const body = extractPlainText(msg.data.payload);
      const occurredAt = dateStr ? new Date(dateStr) : new Date();

      const { inserted: wasInserted } = await ingestEmail(
        {
          investorId: investor.id,
          channel: "email",
          subject: subject || null,
          body: body || null,
          direction,
          occurredAt,
          loggedBy: "gmail_sync",
          gmailMessageId: m.id,
          gmailThreadId: msg.data.threadId ?? null,
        },
        {
          changedBy: null,
          changedByRole: "gmail_sync",
        }
      );
      if (wasInserted) inserted++;
      else skipped++;
    }

    await recordSyncSuccess(cfg.id, new Date());
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[gmail-sync] failed:", msg);
    await recordSyncError(cfg.id, `${new Date().toISOString()} ${msg}`);
  }

  return { processed, inserted, skipped };
}

export function startGmailSyncJob(): void {
  if (!env.gmailClientId || !env.gmailClientSecret) {
    console.log("[gmail-sync] skipped: GMAIL_CLIENT_ID/SECRET not configured");
    return;
  }
  // */15 * * * * = every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    if (running) return; // overlapping-run guard
    running = true;
    try {
      const result = await runGmailSyncOnce();
      console.log(
        `[gmail-sync] processed=${result.processed} inserted=${result.inserted} skipped=${result.skipped}`
      );
    } finally {
      running = false;
    }
  });
  console.log("[gmail-sync] cron scheduled (every 15 min)");
}
