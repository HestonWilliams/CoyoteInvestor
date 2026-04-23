import type { EmailPayload } from "./client";

/**
 * Per-investor capital call notice (PRD §6). Payment instructions are a
 * placeholder — Phase 2 doesn't yet integrate Stripe ACH, so the body
 * directs the LP to contact the GP for wire/ACH coordinates.
 */

export interface CapitalCallNoticeData {
  investorName: string;
  investorEmail: string;
  dealName: string;
  callDate: string;
  dueDate: string | null;
  amountDue: string;
  totalCommitted: string;
  notes: string | null;
}

function money(v: string | number): string {
  const n = typeof v === "string" ? Number(v) : v;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function prettyDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function renderCapitalCallNotice(data: CapitalCallNoticeData): EmailPayload {
  const subject = `${data.dealName} — Capital Call Notice`;

  const html = `
<!doctype html><html><body style="font-family:Inter,system-ui,Arial,sans-serif;background:#fafaf8;margin:0;padding:24px;color:#1f1d18">
  <div style="max-width:560px;margin:0 auto;background:white;border:1px solid #d9cfbe;border-radius:8px;overflow:hidden">
    <div style="padding:20px 24px;border-bottom:1px solid #eee8d9;background:#f7f5f2">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8c7550">Coyote Equity LLC</div>
      <div style="font-size:18px;font-weight:600;color:#231d13;margin-top:2px">Capital Call Notice</div>
    </div>
    <div style="padding:20px 24px">
      <p>Dear ${escapeHtml(data.investorName)},</p>
      <p>This is a capital call for <strong>${escapeHtml(data.dealName)}</strong> dated <strong>${prettyDate(data.callDate)}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#554630">Total Committed</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums">${money(data.totalCommitted)}</td></tr>
        <tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#554630"><strong>Amount Due</strong></td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums"><strong>${money(data.amountDue)}</strong></td></tr>
        <tr><td style="padding:6px 12px;color:#554630">Due Date</td><td style="padding:6px 12px;text-align:right">${prettyDate(data.dueDate)}</td></tr>
      </table>
      <div style="background:#f7f5f2;border:1px solid #eee8d9;border-radius:6px;padding:12px 16px;margin:16px 0;font-size:13px;color:#554630">
        <strong>Wire / ACH Instructions</strong><br />
        Reply to this email for wire or ACH coordinates. An ACH portal is scheduled for a future release.
      </div>
      ${data.notes ? `<p style="white-space:pre-wrap;color:#3a3020">${escapeHtml(data.notes)}</p>` : ""}
    </div>
  </div>
</body></html>`;

  const text = [
    `Capital Call — ${data.dealName}`,
    `Call date: ${prettyDate(data.callDate)}`,
    `Due date: ${prettyDate(data.dueDate)}`,
    ``,
    `Total Committed: ${money(data.totalCommitted)}`,
    `Amount Due:      ${money(data.amountDue)}`,
    ``,
    `Reply to this email for wire/ACH coordinates.`,
    data.notes ? `\nNotes:\n${data.notes}` : "",
    ``,
    `— Coyote Equity LLC`,
  ]
    .filter(Boolean)
    .join("\n");

  return { to: data.investorEmail, subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
