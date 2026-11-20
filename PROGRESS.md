# TaskNest – Progress

Spec: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) (§14 is the 5-day plan). Update this file after each phase.

## Day 1 – Setup and database ✅ (2026-11-20)

- Express 5 + TypeScript 7 (strict, NodeNext ESM) + Biome. `src/app.ts`, `src/server.ts`, `src/routes.ts` (mounts modules under `/api/v1`).
- Zod-checked environment (`src/config/env.ts`) and `.env.example`.
- Prisma 7.10.1 with `@prisma/adapter-pg`; client generated into `src/generated/prisma` (git-ignored, rebuilt on `npm install`). Prisma is pinned because npm's `latest` tag currently points at an 8.0 release candidate.
- Schema: 8 models, 9 enums, indexes, foreign keys (`Restrict`; `Cascade` only for refresh tokens) and 2 CHECK constraints added in the init migration (`payments_amount_positive`, `tasks_completed_at_matches_status`).
- Migration `20261120153646_init` applied to the Postgres schema `tasknest`. The `public` schema (11 tables of the old TeamFlow project) was not touched.
- Seed (`npm run db:seed`): admin, manager, 2 members, project "Website Redesign" with both members, 5 tasks (one per status + one overdue) and 2 comments. Ran twice: idempotent.
- `GET /` and `GET /api/v1/health` (runs `SELECT 1` against the database).
- Vercel setup: `vercel.json` (build into `dist/`, rewrite every path to `/api`), `api/index.js`, `public/robots.txt`.

Verified: `npm run typecheck` ✓ · `npm run lint` ✓ · `npm run build` ✓ · health returns 200 with `database: "up"` from the compiled build ✓ · `prisma migrate status` up to date ✓

Still open from day 1: first Vercel deploy (needs the Vercel project and its environment variables).

## Day 2 – Auth and profile ✅ (2026-11-20)

- Standard responses: `sendResponse` (`{ success, message, data, meta? }`), `AppError`, 404 handler, global error handler (AppError, Prisma P2002/P2025/P2003, malformed JSON, body too large, generic 500 without details).
- Security: helmet, CORS allowlist from `CORS_ORIGINS`, rate limits (300 / 15 min per IP overall; 20 / 15 min on register, login, refresh; skipped in tests), `trust proxy` in production, JSON body limit 100 kb.
- `validate(schema)` middleware (Zod for body, params, query; unknown body fields rejected; field-level errors).
- Auth: register, login, refresh-token, logout. Access JWT 15 min; refresh JWT 7 days stored as a SHA-256 hash, rotated on every use, reuse of an old token ends all sessions; logout revokes all refresh tokens. bcrypt passwords, same 401 for wrong password and unknown email (dummy hash keeps timing equal), ADMIN cannot be chosen at signup.
- `auth` middleware (Bearer token → user loaded from the database, blocked users get 403) and `authorize(...roles)`.
- Google OAuth (authorization code flow with a `state` cookie). **Code ready, not tested end to end yet:** needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Without them `/auth/google` answers 503.
- `GET /users/me` (managers also get plan, limits, active-project usage) and `PATCH /users/me` (name, avatarUrl).
- Tests: Vitest + Supertest on the separate schema `tasknest_test` (migrated automatically; cleaned only after checking the schema name). 39 tests.

Verified: `npm run typecheck` ✓ · `npm run lint` ✓ · `npm test` 39/39 ✓ · `npm run build` ✓ · manual run of the compiled server: demo manager login, `/users/me`, rate-limit headers, logout ✓ · demo data in `tasknest` untouched by tests ✓

Still open: Google login live test (keys), first Vercel deploy.

## Next – Day 3: Projects, members, tasks

- audit log helper (written inside the same transaction as each change)
- projects CRUD with search, filter, sort, pagination; soft delete; archive/activate
- FREE plan limits with row locking (`SELECT … FOR UPDATE`)
- project members: add by email, list, remove (unassign open tasks)
- tasks: create, list (filters, overdue, search, sort), my-assigned, get, update, soft delete
- status workflow (state machine) and assignment; comments
- project stats in `GET /projects/:id`; Redis cache (optional)

## Notes

**Adding a migration later** (no shadow database, never resets anything):

1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/<UTC timestamp>_<name>/migration.sql`
3. Read the SQL, then run `npm run db:deploy` and `npm run db:generate`.

Do not use `prisma migrate dev` or `prisma migrate reset` here: the database is shared with another project.
