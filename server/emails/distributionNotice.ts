import type { EmailPayload } from "./client";

/**
 * Per-investor distribution notice (PRD §6). Shows deal name, date, type,
 * and line-item breakdown so the LP can reconcile against bank deposit.
 */

export interface DistributionNoticeData {
  investorName: string;
  investorEmail: string;
  dealName: string;
  distributionDate: string; // YYYY-MM-DD
  type: string;
  grossAmount: string;
  prefComponent: string;
  returnOfCapital: string;
  profitSplit: string;
  netAmount: string;
  paymentMethod: string | null;
  paymentRef: string | null;
}

function money(v: string | number): string {
  const n = typeof v === "string" ? Number(v) : v;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function prettyDate(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function renderDistributionNotice(data: DistributionNoticeData): EmailPayload {
  const date = prettyDate(data.distributionDate);
  const typeLabel = data.type.replace(/_/g, " ");

  const subject = `${data.dealName} — Distribution Notice (${date})`;

  const rows: Array<[string, string]> = [
    ["Gross Amount", money(data.grossAmount)],
    ["Preferred Return", money(data.prefComponent)],
    ["Return of Capital", money(data.returnOfCapital)],
    ["Profit Share", money(data.profitSplit)],
    ["Net Amount", money(data.netAmount)],
  ];

  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#554630">${label}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums">${value}</td></tr>`
    )
    .join("");

  const html = `
<!doctype html><html><body style="font-family:Inter,system-ui,Arial,sans-serif;background:#fafaf8;margin:0;padding:24px;color:#1f1d18">
  <div style="max-width:560px;margin:0 auto;background:white;border:1px solid #d9cfbe;border-radius:8px;overflow:hidden">
    <div style="padding:20px 24px;border-bottom:1px solid #eee8d9;background:#f7f5f2">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8c7550">Coyote Equity LLC</div>
      <div style="font-size:18px;font-weight:600;color:#231d13;margin-top:2px">Distribution Notice</div>
    </div>
    <div style="padding:20px 24px">
      <p>Dear ${escapeHtml(data.investorName)},</p>
      <p>A <strong>${escapeHtml(typeLabel)}</strong> distribution has been approved for <strong>${escapeHtml(data.dealName)}</strong>, effective <strong>${date}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">${rowsHtml}</table>
      ${
        data.paymentMethod
          ? `<p style="font-size:13px;color:#554630">Payment method: <strong>${escapeHtml(data.paymentMethod)}</strong>${
              data.paymentRef
                ? ` · reference <code style="background:#eee8d9;padding:2px 6px;border-radius:3px">${escapeHtml(data.paymentRef)}</code>`
                : ""
            }</p>`
          : ""
      }
      <p style="font-size:13px;color:#6f5c3e;margin-top:24px">If you have any questions, reply to this email.</p>
    </div>
  </div>
</body></html>`;

  const text = [
    `Distribution Notice — ${data.dealName}`,
    `Effective date: ${date}`,
    `Type: ${typeLabel}`,
    ``,
    `Gross Amount:       ${money(data.grossAmount)}`,
    `Preferred Return:   ${money(data.prefComponent)}`,
    `Return of Capital:  ${money(data.returnOfCapital)}`,
    `Profit Share:       ${money(data.profitSplit)}`,
    `Net Amount:         ${money(data.netAmount)}`,
    ``,
    data.paymentMethod
      ? `Payment method: ${data.paymentMethod}${data.paymentRef ? ` — ref ${data.paymentRef}` : ""}`
      : "",
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
