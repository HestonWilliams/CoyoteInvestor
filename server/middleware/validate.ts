import type { Request, Response, NextFunction } from "express";
import { ZodError, type ZodSchema } from "zod";

/**
 * Request validator. Strips unknown keys by running the body/query/params
 * through a Zod schema (PRD §11.7). Replaces req.body/query/params with the
 * parsed result so downstream handlers work with typed, sanitized data.
 *
 * Usage: `validate({ body: schema, query: schema, params: schema })`
 */
export function validate(schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        // Mutate in place — Express 4 req.query is a getter but assignable.
        (req as any).query = parsed;
      }
      if (schemas.params) (req as any).params = schemas.params.parse(req.params);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Validation failed", details: err.flatten() });
      }
      next(err);
    }
  };
}
