import { env } from "../lib/env";
import { writeAudit } from "../services/audit";

/**
 * Resend wrapper + defensive send() that isolates email failures from the
 * DB transactions that triggered them. Callers MUST commit their DB work
 * first, then fire these off. A failed send logs an audit row with
 * event=email_failed and swallows the error; it never throws back up into
 * the caller so a prod outage at Resend can never undo a paid distribution.
 */

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendContext {
  tableName: string;
  recordId: string;
  purpose: string; // e.g. "distribution_notice" | "capital_call_notice"
}

export async function sendEmail(payload: EmailPayload, ctx: SendContext): Promise<boolean> {
  if (!env.resendApiKey) {
    if (env.isDev) {
      console.log(
        `[email:dev] purpose=${ctx.purpose} to=${payload.to} subject="${payload.subject}"`
      );
      return true;
    }
    await logFailure(ctx, payload.to, "RESEND_API_KEY not set");
    return false;
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(env.resendApiKey);
    const { error } = await resend.emails.send({
      from: env.resendFrom,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
    if (error) {
      await logFailure(ctx, payload.to, String(error.message ?? error));
      return false;
    }
    return true;
  } catch (err) {
    await logFailure(
      ctx,
      payload.to,
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

async function logFailure(ctx: SendContext, to: string, message: string) {
  console.error(`[email] send failed purpose=${ctx.purpose} to=${to}: ${message}`);
  await writeAudit(
    { changedBy: null, changedByRole: "system" },
    {
      tableName: ctx.tableName,
      recordId: ctx.recordId,
      action: "UPDATE",
      newValues: {
        event: "email_failed",
        purpose: ctx.purpose,
        to,
        error: message,
      },
    }
  );
}
