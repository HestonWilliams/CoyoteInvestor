import { Router, type Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ingestEmail, findInvestorByAnyEmail } from "../services/communications";
import { env } from "../lib/env";

/**
 * BCC ingest webhook (PRD §5.8).
 *
 * Dedicated inbound address `log@coyoteequity.com` configured at Resend →
 * Resend hits this endpoint on delivery → we parse and log regardless of
 * whether the contact is in the CRM yet.
 *
 * Signature verification: Resend inbound webhooks sign with a Svix-style
 * HMAC. We accept either an `svix-signature` header or a plain
 * `x-webhook-signature: sha256=<hex>` depending on which variant is wired
 * up. Failure rejects with 401 rather than silently logging.
 */

const payloadSchema = z.object({
  from: z.string().optional(),
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  html: z.string().optional().nullable(),
  message_id: z.string().optional().nullable(),
  received_at: z.string().optional().nullable(),
});

function verifySignature(req: Request): boolean {
  if (!env.bccIngestSecret) {
    // In dev, allow unsigned; in prod, refuse.
    return env.isDev;
  }

  const rawBody: Buffer | string | undefined = (req as any).rawBody;
  if (!rawBody) return false;

  // Simple sha256 HMAC — "x-webhook-signature: sha256=<hex>"
  const sigHeader = (req.headers["x-webhook-signature"] as string | undefined) ?? "";
  if (sigHeader.startsWith("sha256=")) {
    const supplied = Buffer.from(sigHeader.slice("sha256=".length), "hex");
    const computed = createHmac("sha256", env.bccIngestSecret)
      .update(typeof rawBody === "string" ? rawBody : rawBody)
      .digest();
    if (supplied.length !== computed.length) return false;
    return timingSafeEqual(supplied, computed);
  }

  // Svix-style header: fall through and accept only if signature matches.
  const svixSig = (req.headers["svix-signature"] as string | undefined) ?? "";
  const svixId = (req.headers["svix-id"] as string | undefined) ?? "";
  const svixTs = (req.headers["svix-timestamp"] as string | undefined) ?? "";
  if (!svixSig || !svixId || !svixTs) return false;

  const toSign = `${svixId}.${svixTs}.${typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")}`;
  const expected = createHmac("sha256", env.bccIngestSecret).update(toSign).digest("base64");

  return svixSig
    .split(" ")
    .map((s) => s.split(",")[1])
    .filter(Boolean)
    .some((sig) => {
      const a = Buffer.from(sig, "utf8");
      const b = Buffer.from(expected, "utf8");
      return a.length === b.length && timingSafeEqual(a, b);
    });
}

function parseAddrList(input?: string | string[] | null): string[] {
  if (!input) return [];
  const joined = Array.isArray(input) ? input.join(",") : input;
  return (joined.match(/[\w.+\-]+@[\w.\-]+/g) ?? []).map((s) => s.toLowerCase());
}

export const commsIngestRouter = Router();

commsIngestRouter.post("/", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }
  const p = parsed.data;

  const senderAddrs = parseAddrList(p.from);
  const recipientAddrs = [
    ...parseAddrList(p.to as any),
    ...parseAddrList(p.cc as any),
    ...parseAddrList(p.bcc as any),
  ];
  const allAddrs = [...senderAddrs, ...recipientAddrs];

  const investor = await findInvestorByAnyEmail(allAddrs);

  const gpEmail = env.gpGmailAddress.toLowerCase();
  const direction: "inbound" | "outbound" = senderAddrs.includes(gpEmail) ? "outbound" : "inbound";

  const result = await ingestEmail(
    {
      investorId: investor?.id ?? null,
      channel: "email",
      subject: p.subject ?? null,
      body: p.text ?? p.html ?? null,
      direction,
      occurredAt: p.received_at ? new Date(p.received_at) : new Date(),
      loggedBy: "bcc_ingest",
      gmailMessageId: p.message_id ?? null,
    },
    { changedBy: null, changedByRole: "system" }
  );

  res.status(202).json({ logged: result.inserted, id: result.id, matched: !!investor });
});
