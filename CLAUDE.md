# Coyote Equity Investor Manager

Full-stack TypeScript app replacing Appfolio Investment Manager for a real estate syndication firm. See `CoyoteEquity_InvestorManager_PRD.md` for the canonical spec.

## Structure

- `shared/schema.ts` — single source of truth for all DB tables (Drizzle).
- `db/index.ts` — Neon serverless driver + Drizzle client.
- `server/` — Express API. Dev entry `index-dev.ts` boots Vite middleware; prod `index-prod.ts` serves the built client.
- `server/lib/crypto.ts` — AES-256-GCM utility. **All sensitive fields MUST round-trip through this utility.** See Section 11.1 of the PRD for the list.
- `server/services/*` — service layer that wraps Drizzle and enforces encryption + audit logging on mutations.
- `server/auth/` — GP bcrypt + refresh-rotation + LP magic-link.
- `server/middleware/` — helmet, CORS, rate limits, `requireAuth`, `requireRole`, Zod validator.
- `client/` — Vite + React + Tailwind. Path aliases `@/*` (client/src) and `@shared/*`.

## Security invariants (from PRD §11 — do not violate)

1. `investors.address`, `investors.ssn_ein_last4`, `gmail_sync_config.access_token`, `gmail_sync_config.refresh_token` and all future bank/routing fields are encrypted at the application layer. Never log decrypted values.
2. Refresh tokens live in DB (`refresh_tokens`) and are rotated on every `/api/auth/refresh`. Old token is marked revoked. Access token is 15 min; refresh is 7 days; both httpOnly + SameSite=Lax (Strict in prod).
3. LP magic-link tokens: single-use, 15-min, stored as bcrypt hash — never reversible, never echoed back in any response.
4. Every mutation that goes through a `server/services/*` helper writes an `audit_log` row. Do not bypass the service layer for writes.
5. LP routes must derive `investor_id` from the JWT only — never trust a request param.
6. No raw SQL string interpolation. Drizzle parameterized queries only.

## Conventions

- Monetary values: `numeric` in Postgres, `string` (not float) in TS. Use a decimal library when doing math.
- All API responses validated by Zod before responding; request bodies validated before touching the DB.
- 50MB file upload cap; PDF/DOCX/XLSX only (Phase 3).
