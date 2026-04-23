# Coyote Equity Investor Manager — Replit Deployment

Mirrors the HamLogPro deployment pattern: Vite dev server runs in middleware mode off the Express server; production serves the built bundle from `dist/public`.

## Setup

1. In Replit **Secrets**, add every variable from `.env.example`.
   - `ENCRYPTION_KEY` and `JWT_SECRET` **must** be generated locally with `openssl rand -hex 32` / `openssl rand -hex 64` — do not commit.
2. `npm install`
3. `npm run db:push` (provisions the Neon schema)
4. Seed the first GP user by running:
   ```
   tsx server/scripts/seed-gp.ts --email you@coyoteequity.com --password '...'
   ```
5. `npm run dev` (dev) or `npm run build && npm start` (prod)

## Phase 1 surface

- `/api/auth/*` — GP login/refresh/logout + LP magic-link request/verify
- `/api/deals` CRUD
- `/api/investors` CRUD + `/import` (Appfolio CSV)
- `/api/dashboard/summary` (GP portfolio cards)
- `/api/auth/gmail` OAuth2 connect + callback
- `/api/comms/ingest` (Resend inbound webhook)
- Background: Gmail sync every 15 min (node-cron)

Phases 2–5 are stubbed in the PRD and not yet implemented.
