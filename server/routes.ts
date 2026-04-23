import { type Server, createServer } from "node:http";
import type { Express, Request, Response } from "express";
import { gpAuthRouter } from "./auth/gpAuth";
import { lpAuthRouter } from "./auth/lpAuth";
import { requireAuth } from "./middleware/auth";
import { dealsRouter } from "./routes/deals";
import { investorsRouter } from "./routes/investors";
import { dashboardRouter } from "./routes/dashboard";
import { gmailAuthRouter } from "./routes/gmailAuth";
import { commsIngestRouter } from "./routes/commsIngest";
import { distributionsRouter } from "./routes/distributions";
import { capitalCallsRouter } from "./routes/capitalCalls";
import { ledgerRouter } from "./routes/ledger";
import { runGmailSyncOnce } from "./jobs/gmailSync";

/**
 * Mounts every API route. Kept deliberately flat so the mount order is
 * auditable at a glance: unauthenticated routes first (auth + webhook),
 * then authenticated GP routes.
 */
export function registerRoutes(app: Express): Server {
  // --- Auth ---
  app.use("/api/auth/gp", gpAuthRouter);
  app.use("/api/auth/lp", lpAuthRouter);
  app.use("/api/auth/gmail", gmailAuthRouter);

  // GP session probe (reads cookie, must go through requireAuth)
  app.get("/api/auth/me", requireAuth, (req, res) => {
    const auth = (req as any).auth;
    res.json({ sub: auth.sub, role: auth.role });
  });

  // --- Webhooks (unauthenticated, HMAC-verified) ---
  app.use("/api/comms/ingest", commsIngestRouter);

  // --- Business resources ---
  app.use("/api/deals", dealsRouter);
  app.use("/api/investors", investorsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/distributions", distributionsRouter);
  app.use("/api/capital-calls", capitalCallsRouter);
  app.use("/api/ledger", ledgerRouter);

  // --- Manual trigger for the gmail sync (dev/ops) ---
  app.post("/api/ops/gmail-sync", requireAuth, async (_req: Request, res: Response) => {
    const result = await runGmailSyncOnce();
    res.json(result);
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  return createServer(app);
}
