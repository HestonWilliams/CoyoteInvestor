import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

/** Central error handler — last in the middleware chain. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: err.flatten() });
  }
  // CORS rejection from our origin callback
  if (err instanceof Error && err.message?.startsWith("CORS blocked:")) {
    return res.status(403).json({ error: "CORS blocked" });
  }
  console.error("[unhandled]", err);
  const status = (err as any)?.status ?? 500;
  res.status(status).json({ error: status === 500 ? "Internal server error" : String((err as any)?.message ?? "Error") });
}
