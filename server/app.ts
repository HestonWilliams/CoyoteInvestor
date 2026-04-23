import { type Server } from "node:http";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { installSecurity } from "./middleware/security";
import { errorHandler } from "./middleware/error";
import { registerRoutes } from "./routes";
import { startGmailSyncJob } from "./jobs/gmailSync";
import { env } from "./lib/env";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const t = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${t} [${source}] ${message}`);
}

export const app: Express = express();
app.set("trust proxy", 1);

export default async function runApp(
  installClient: (app: Express, server: Server) => Promise<void>
): Promise<void> {
  // Security headers + CORS + global rate limit must run before body parsing
  // so rejected origins don't even reach the parser.
  installSecurity(app);

  // Capture raw body for HMAC signature verification on webhook routes.
  app.use(
    express.json({
      limit: "12mb",
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Minimal access log for /api/* (status + duration).
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) return next();
    const start = Date.now();
    res.on("finish", () =>
      log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`)
    );
    next();
  });

  const server = registerRoutes(app);

  // Serve the SPA (Vite middleware in dev, static files in prod).
  await installClient(app, server);

  // Mount error handler last so upstream handlers' throws hit it.
  app.use(errorHandler);

  // Start the Gmail sync cron once per process.
  startGmailSyncJob();

  server.listen(env.port, "0.0.0.0", () => log(`Listening on :${env.port}`));
}
