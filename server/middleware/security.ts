import type { Express } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { env } from "../lib/env";

/**
 * Wires helmet, CORS, and the global rate limiter (PRD §11.6/§11.7).
 *
 * CORS is restricted to the exact list in CORS_ORIGINS — no wildcards in
 * prod. Non-CORS tools (curl, server-to-server callers like Resend's
 * webhook) skip the browser origin check by sending no Origin header.
 */
export function installSecurity(app: Express): void {
  app.use(
    helmet({
      contentSecurityPolicy: env.isProd
        ? {
            useDefaults: true,
            directives: {
              "default-src": ["'self'"],
              "img-src": ["'self'", "data:"],
              "script-src": ["'self'"],
              "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              "font-src": ["'self'", "https://fonts.gstatic.com"],
              "connect-src": ["'self'"],
              "frame-ancestors": ["'none'"],
            },
          }
        : false, // HMR + dev-banner need a looser dev CSP
      crossOriginEmbedderPolicy: false,
    })
  );

  // Scoped to /api/* so the browser's same-origin module/asset fetches
  // served by Vite (dev) or static middleware (prod) aren't rejected when
  // the page origin isn't in CORS_ORIGINS.
  //
  // In dev, always allow the server's own origin (http://localhost:<port>)
  // regardless of CORS_ORIGINS — the frontend is served from the same
  // Express process via Vite middleware, so same-origin requests must
  // succeed even if CORS_ORIGINS is misconfigured or points at a
  // standalone-Vite port.
  const devAllowed = env.isDev
    ? new Set([`http://localhost:${env.port}`, `http://127.0.0.1:${env.port}`])
    : new Set<string>();
  app.use(
    "/api",
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // curl / server-to-server
        if (env.corsOrigins.includes(origin)) return cb(null, true);
        if (devAllowed.has(origin)) return cb(null, true);
        return cb(new Error(`CORS blocked: ${origin}`));
      },
      credentials: true,
    })
  );

  // Global floor — per-route limiters (login, magic-link) are stricter.
  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use("/api/", globalLimiter);
}
