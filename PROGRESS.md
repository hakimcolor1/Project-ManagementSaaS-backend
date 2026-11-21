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

## Day 3 – Projects, members, tasks, comments ✅ (2026-11-20)

- Helpers: `writeAuditLog(tx, …)` (always inside the change's transaction), `pagination.ts` (page/limit max 100, `sortBy` allow-lists, search, `true`/`false` flags, meta), `validators.ts` (UUID ids, ISO due dates not in the past; a plain date = end of that day UTC), `taskWorkflow.ts` (status-move table §3.2, overdue rule), `lockRow()` (`SELECT … FOR UPDATE` on the schema-qualified table).
- Projects (8 endpoints incl. members): workspace isolation (manager = owner, member = active membership, else 404; admin 403), search/filter/sort/pagination, stats (tasks by status, overdue, progress %, members), archive/activate, soft delete of project + tasks in one transaction.
- Plan limits (BR-8): FREE = 2 active projects (owner row locked) and 3 members per project (project row locked) → 402. Archived projects do not count; activating again re-checks the limit. Parallel creates at the limit: only one wins (tested).
- Members (BR-9/10): add by email (must be an ACTIVE MEMBER, else 400; twice → 409), list, remove (open tasks → unassigned TODO in the same transaction, DONE keeps the assignee), re-adding restores the membership row.
- Tasks (10 endpoints incl. comments): create with optional assignee, list with filters (`projectId`, `status`, `priority`, `assigneeId`, `overdue`, `search`) and sorting (priority in enum order, due date nulls last), my-assigned (MEMBER), details with `isOverdue`, `commentCount`, `nextStatuses`, edit, soft delete, assign/reassign/unassign (BR-13), status moves with optimistic check (`WHERE status = old` → 409 for the loser), comments (oldest first, paginated).
- Archived project = read-only (409) for tasks, members, comments and edits.
- Optional Upstash Redis cache (`@upstash/redis` 1.41.0): project stats `project:<id>:stats` for 5 minutes, cleared after every task/member/project change. Off when the env vars are empty and always off in tests; Redis errors are logged and ignored.
- Tests: 85 (46 new) — projects/limits/members/archive/delete, full §3.1 workflow, permissions, concurrency, lists, comments, unit tests for the status table and helpers.

Verified: `npm run typecheck` ✓ · `npm run lint` ✓ · `npm test` 85/85 ✓ · smoke test on the demo data in `tasknest` (manager list + stats, member my-assigned, overdue filter) ✓

Known: tests take ~2.5 minutes (remote database round trips). Prisma's pg adapter prints a `pg` deprecation warning ("client.query() while already executing") from inside its own transaction code; harmless, not from TaskNest code.

## Next – Day 4: Payments, admin, Postman

- SSLCommerz: initiate (server-side amount 500.00 BDT), success/fail/cancel/IPN with server-to-server validation, idempotent activation (+30 days), payment history
- admin: users list/search, role change (BR-23), block/unblock (BR-24), stats (cached 60 s), audit logs with filters
- Postman collection + environment
- Still open from earlier: Google login live test (keys), first Vercel deploy

## Notes

**Adding a migration later** (no shadow database, never resets anything):

1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/<UTC timestamp>_<name>/migration.sql`
3. Read the SQL, then run `npm run db:deploy` and `npm run db:generate`.

Do not use `prisma migrate dev` or `prisma migrate reset` here: the database is shared with another project.
