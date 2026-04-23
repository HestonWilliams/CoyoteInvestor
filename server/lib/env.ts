/**
 * Centralized env access with fail-fast validation for required secrets.
 * Keeps runtime code from sprinkling `process.env.X!` everywhere.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 5001),
  publicUrl: optional("PUBLIC_URL", "http://localhost:5000"),

  // --- Security ---
  jwtSecret: () => required("JWT_SECRET"),
  encryptionKey: () => required("ENCRYPTION_KEY"),
  cookieSecure: (process.env.COOKIE_SECURE ?? "false") === "true",
  cookieDomain: optional("COOKIE_DOMAIN"),
  corsOrigins: optional("CORS_ORIGINS", "http://localhost:5000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // --- Email ---
  resendApiKey: optional("RESEND_API_KEY"),
  resendFrom: optional("RESEND_FROM_EMAIL", "no-reply@coyoteequity.com"),
  bccIngestSecret: optional("BCC_INGEST_WEBHOOK_SECRET"),

  // --- Gmail ---
  gmailClientId: optional("GMAIL_CLIENT_ID"),
  gmailClientSecret: optional("GMAIL_CLIENT_SECRET"),
  gmailRedirectUri: optional(
    "GMAIL_REDIRECT_URI",
    "http://localhost:5001/api/auth/gmail/callback"
  ),
  gpGmailAddress: optional("GP_GMAIL_ADDRESS", ""),

  // --- Dev ---
  isDev: (process.env.NODE_ENV ?? "development") !== "production",
  isProd: process.env.NODE_ENV === "production",
};
