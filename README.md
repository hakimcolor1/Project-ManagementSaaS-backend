# TaskNest – Project Management SaaS (Backend)

TaskNest is a REST API for small teams. A manager creates projects, adds team members and assigns tasks. Members move their tasks through a fixed workflow (TODO → IN_PROGRESS → IN_REVIEW → DONE) and the manager approves the work. A FREE plan has limits; managers upgrade to PRO with an SSLCommerz payment.

> B7A6 backend assignment (Project Management SaaS). Backend only, no frontend; use Postman.
> Full requirements: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) · Build status: [PROGRESS.md](PROGRESS.md)

## Roles

| Role | Can do |
| --- | --- |
| ADMIN | Manage users (role, block/unblock), platform stats, audit logs, all payments |
| MANAGER | Own projects, members and tasks; approve work; pay for PRO |
| MEMBER | Work on assigned tasks in joined projects; comment |

## Tech stack

Node.js 24 · TypeScript · Express 5 · PostgreSQL (Prisma Postgres) + Prisma ORM 7 · Zod · JWT · Google OAuth · Upstash Redis (optional cache) · helmet · CORS · express-rate-limit · Vitest + Supertest · Biome · Vercel

Architecture: Routes → Controllers → Services → Prisma.

## API (ready so far)

Base URL: `/api/v1`. Protected routes need `Authorization: Bearer <accessToken>`.

| Method and path | Access | What it does |
| --- | --- | --- |
| `POST /auth/register` | public | Create an account (`name`, `email`, `password`, `role`: MANAGER or MEMBER) → user + tokens |
| `POST /auth/login` | public | Email + password → user + tokens |
| `POST /auth/refresh-token` | public | `refreshToken` → new token pair (the old one is revoked) |
| `POST /auth/logout` | any role | Revoke all refresh tokens of the user |
| `GET /auth/google?role=MANAGER` | public | Open in a browser → Google sign-in (needs Google keys) |
| `GET /auth/google/callback` | public | Google returns here → user + tokens as JSON |
| `GET /users/me` | any role | Profile; managers also get plan, limits and usage |
| `PATCH /users/me` | any role | Update `name` and/or `avatarUrl` |
| `POST /projects` | MANAGER | Create a project (`name`, `description?`, `dueDate?`); FREE plan: 2 active projects |
| `GET /projects` | MANAGER, MEMBER | Own or joined projects · `page`, `limit`, `search`, `status`, `sortBy` (createdAt, name, dueDate), `sortOrder` |
| `GET /projects/:id` | MANAGER, MEMBER | Project + stats: tasks by status, overdue tasks, progress %, members |
| `PATCH /projects/:id` | MANAGER (owner) | Update `name`, `description`, `dueDate`, `status` (ACTIVE or ARCHIVED) |
| `DELETE /projects/:id` | MANAGER (owner) | Soft delete the project and its tasks |
| `POST /projects/:id/members` | MANAGER (owner) | Add a MEMBER by `email`; FREE plan: 3 members per project |
| `GET /projects/:id/members` | MANAGER, MEMBER | List members |
| `DELETE /projects/:id/members/:userId` | MANAGER (owner) | Remove a member; their open tasks go back to TODO, unassigned |
| `POST /projects/:id/tasks` | MANAGER (owner) | Create a task (`title`, `description?`, `priority?`, `dueDate?`, `assigneeId?`) |
| `GET /tasks` | MANAGER, MEMBER | Tasks in my projects · `search`, `projectId`, `status`, `priority`, `assigneeId`, `overdue=true`, `sortBy` (createdAt, dueDate, priority, title) |
| `GET /tasks/my-assigned` | MEMBER | My tasks · `status`, `priority`, `overdue=true`, `sortBy` (createdAt, dueDate, priority) |
| `GET /tasks/:id` | MANAGER, MEMBER | Task details, `isOverdue`, `commentCount` and the `nextStatuses` you may set |
| `PATCH /tasks/:id` | MANAGER (owner) | Edit `title`, `description`, `priority`, `dueDate` |
| `DELETE /tasks/:id` | MANAGER (owner) | Soft delete |
| `PATCH /tasks/:id/status` | owner or assignee | Move the status (see the workflow below) |
| `PATCH /tasks/:id/assign` | MANAGER (owner) | `assigneeId` to assign or reassign, `null` to unassign (TODO only) |
| `POST /tasks/:id/comments` | MANAGER, MEMBER | Add a comment (`body`, 1–2000 characters) |
| `GET /tasks/:id/comments` | MANAGER, MEMBER | Comments, oldest first, paginated |
| `GET /health` | public | API and database status |

**Task workflow:** the assignee moves TODO → IN_PROGRESS → IN_REVIEW (and IN_PROGRESS → TODO). The project owner can do the same, and also approves (IN_REVIEW → DONE), sends back (IN_REVIEW → IN_PROGRESS) and reopens (DONE → IN_PROGRESS). Any other move is 409. A task needs an assignee before it leaves TODO.

**Rules worth knowing:** a project outside your workspace answers 404; an archived project is read-only (409); a plan limit answers 402 "Upgrade to PRO"; dates are ISO 8601 (a plain date like `2026-12-31` means the end of that day, UTC) and a due date cannot be in the past. Every project, member and task change writes an audit log row in the same transaction.

Every response uses one format:

```json
{ "success": true, "message": "Logged in successfully", "data": { } }
{ "success": false, "message": "Validation failed", "errors": [{ "field": "email", "message": "Enter a valid email address" }] }
```

**Auth details:** access token 15 minutes, refresh token 7 days. Refresh tokens are stored only as SHA-256 hashes and rotate on every use; reusing an old one ends all sessions of that user. Passwords are hashed with bcrypt. The role is read from the database on every request, so blocking a user works immediately.

## Getting started

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # then fill in the values
npm run db:deploy           # apply migrations (creates the "tasknest" schema)
npm run db:seed             # demo accounts and a sample project
npm run dev                 # http://localhost:5000
```

Check it works: `GET http://localhost:5000/api/v1/health`

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the API with auto-reload |
| `npm run build` | Generate the Prisma client and compile to `dist/` |
| `npm start` | Run the compiled API |
| `npm run typecheck` | TypeScript check |
| `npm run lint` / `npm run lint:fix` | Biome lint + format check / auto-fix |
| `npm test` | Unit + API tests (Vitest + Supertest) on the separate `tasknest_test` schema |
| `npm run db:deploy` | Apply migrations |
| `npm run db:status` | Show migration status |
| `npm run db:seed` | Seed demo data (safe to run again) |
| `npm run db:studio` | Open Prisma Studio |

## Demo accounts (seed)

| Role | Email | Password |
| --- | --- | --- |
| ADMIN | `admin@tasknest.com` | value of `ADMIN_PASSWORD` (demo: `Admin@12345`) |
| MANAGER | `manager@tasknest.com` | `Manager@123` |
| MEMBER | `rahim@tasknest.com` | `Member@123` |
| MEMBER | `karim@tasknest.com` | `Member@123` |

## Database

- PostgreSQL through Prisma. All tables live in the Postgres schema **`tasknest`**, set by `&schema=tasknest` at the end of `DATABASE_URL`.
- 8 tables: users, refresh_tokens, projects, project_members, tasks, comments, payments, audit_logs. Foreign keys, unique constraints, indexes, Postgres enums and two CHECK constraints (positive payment amount; `completed_at` only for DONE tasks).
- Soft delete for projects, tasks and memberships.
- Never run `prisma migrate reset` or `prisma db push --force-reset` against the shared database.

## Project structure

```text
api/index.js            Vercel entry (serves dist/app.js)
prisma/                 schema.prisma, migrations/, seed.ts
src/
  app.ts                Express app
  server.ts             local server
  routes.ts             mounts modules under /api/v1
  config/env.ts         Zod-checked environment variables
  lib/                  prisma (pg adapter, tasknest schema, row locks), cache (Upstash), jwt, google
  middlewares/          auth, authorize, validate, rateLimit, notFound, errorHandler
  modules/<name>/       routes → controller → service (+ validation) per module
                        auth, users, health, projects (+ members), tasks (+ comments)
  utils/                AppError, sendResponse, pagination, audit, taskWorkflow, validators,
                        password, hash, plan, duration
tests/                  Vitest + Supertest (separate tasknest_test schema)
docs/REQUIREMENTS.md    requirements, ERD, API plan
```
