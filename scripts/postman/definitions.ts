/**
 * Every request of the TaskNest Postman collection, in run order.
 * `npm run docs:postman` turns this list into docs/TaskNest.postman_collection.json and records
 * a real example response for each request.
 *
 * Paths are relative to {{baseUrl}} (…/api/v1). {{name}} values are collection variables that
 * earlier requests save (tokens, ids); {{$timestamp}} is Postman's built-in timestamp.
 */

export type TokenVar =
  | "adminToken"
  | "managerToken"
  | "memberToken"
  | "newManagerToken"
  | "newMemberToken";

export type RequestDef = {
  name: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  description: string;
  query?: Record<string, string>;
  auth?: TokenVar;
  json?: unknown;
  /** Sent as-is with Content-Type: application/json (used for the malformed JSON example). */
  rawBody?: string;
  /** application/x-www-form-urlencoded, like SSLCommerz callbacks. */
  form?: Record<string, string>;
  /** Expected status. With several, Postman accepts any; the example run expects the first. */
  expect: number | number[];
  /** Collection variable → path inside `data` of a successful response. */
  save?: Record<string, string>;
  /** The response is not JSON (a redirect). */
  notJson?: boolean;
  /** Do not record an example (one is written by hand in build.ts instead). */
  skipRecording?: boolean;
};

export type FolderDef = { name: string; description: string; items: RequestDef[] };

export const DEMO_VAL_ID = "VAL-DEMO-0001";

export const folders: FolderDef[] = [
  {
    name: "0. Health",
    description: "Public check that the API and its database are up.",
    items: [
      {
        name: "Health check",
        method: "GET",
        path: "/health",
        expect: 200,
        description: 'Public. Returns `database: "up"` when the API can reach PostgreSQL.',
      },
    ],
  },
  {
    name: "1. Auth",
    description:
      "Email/password and Google login. Login requests save the tokens into collection variables automatically, so the next requests just work.\n\n- Access token: 15 minutes, sent as `Authorization: Bearer <token>`.\n- Refresh token: 7 days, rotated on every use; using an old one again ends all sessions.\n\nDemo accounts: `admin@tasknest.com` / `Admin@12345`, `manager@tasknest.com` / `Manager@123`, `rahim@tasknest.com` / `Member@123`.",
    items: [
      {
        name: "Register a manager",
        method: "POST",
        path: "/auth/register",
        json: {
          name: "Postman Manager",
          email: "pm.manager.{{$timestamp}}@example.com",
          password: "Secret123",
          role: "MANAGER",
        },
        expect: 201,
        save: { newManagerToken: "accessToken", newManagerId: "user.id" },
        description:
          "Public. Creates an account and logs it in. `role` is `MANAGER` or `MEMBER` (default `MEMBER`); `ADMIN` is never accepted. Password: 8–64 characters with a letter and a number.",
      },
      {
        name: "Register a member",
        method: "POST",
        path: "/auth/register",
        json: {
          name: "Postman Member",
          email: "pm.member.{{$timestamp}}@example.com",
          password: "Secret123",
        },
        expect: 201,
        save: {
          newMemberToken: "accessToken",
          newMemberId: "user.id",
          newMemberEmail: "user.email",
        },
        description: "Public. Without `role` the account is a MEMBER.",
      },
      {
        name: "Register a second member",
        method: "POST",
        path: "/auth/register",
        json: {
          name: "Postman Helper",
          email: "pm.helper.{{$timestamp}}@example.com",
          password: "Secret123",
          role: "MEMBER",
        },
        expect: 201,
        save: { extraMemberId: "user.id" },
        description: "Public. Used later by the admin requests (role change, block/unblock).",
      },
      {
        name: "Register – validation error",
        method: "POST",
        path: "/auth/register",
        json: { name: "N", email: "not-an-email", password: "short", role: "ADMIN" },
        expect: 400,
        description:
          "Shows the error format: `errors` lists every invalid field with a message. Signing up as ADMIN is rejected.",
      },
      {
        name: "Login as ADMIN",
        method: "POST",
        path: "/auth/login",
        json: { email: "admin@tasknest.com", password: "Admin@12345" },
        expect: 200,
        save: { adminToken: "accessToken" },
        description: "Public. Seeded demo admin. Saves `adminToken`.",
      },
      {
        name: "Login as MANAGER",
        method: "POST",
        path: "/auth/login",
        json: { email: "manager@tasknest.com", password: "Manager@123" },
        expect: 200,
        save: { managerToken: "accessToken", managerRefreshToken: "refreshToken" },
        description: 'Public. Seeded demo manager (owns the project "Website Redesign").',
      },
      {
        name: "Login as MEMBER",
        method: "POST",
        path: "/auth/login",
        json: { email: "rahim@tasknest.com", password: "Member@123" },
        expect: 200,
        save: { memberToken: "accessToken" },
        description: 'Public. Seeded demo member of "Website Redesign".',
      },
      {
        name: "Login – wrong password",
        method: "POST",
        path: "/auth/login",
        json: { email: "manager@tasknest.com", password: "WrongPass1" },
        expect: 401,
        description:
          "The same 401 message is used for an unknown email, a wrong password and a Google-only account.",
      },
      {
        name: "Refresh tokens",
        method: "POST",
        path: "/auth/refresh-token",
        json: { refreshToken: "{{managerRefreshToken}}" },
        expect: 200,
        save: { managerToken: "accessToken", managerRefreshToken: "refreshToken" },
        description:
          "Public. Returns a new token pair; the refresh token you sent is revoked (rotation).",
      },
      {
        name: "Google login (open in a browser)",
        method: "GET",
        path: "/auth/google",
        query: { role: "MANAGER" },
        expect: [302, 503],
        notJson: true,
        skipRecording: true,
        description:
          "Public. Open `{{baseUrl}}/auth/google?role=MANAGER` in a **browser**: it redirects to Google; after sign-in Google calls the callback below, which answers with the tokens as JSON. `role` (MANAGER or MEMBER) is used only for a new account. Answers 503 when Google is not configured on the server.",
      },
      {
        name: "Google login callback",
        method: "GET",
        path: "/auth/google/callback",
        query: { code: "code-from-google", state: "state-from-google" },
        expect: 400,
        description:
          "Called by Google (not by you). It checks the `state` cookie set by the request above, exchanges the code and verifies Google's ID token. Called directly like this it answers 400.",
      },
    ],
  },
  {
    name: "2. Profile",
    description: "The logged-in user's own profile.",
    items: [
      {
        name: "Get my profile",
        method: "GET",
        path: "/users/me",
        auth: "managerToken",
        expect: 200,
        description:
          "Any role. Managers also get `subscription`: the current plan, its limits and how much is used.",
      },
      {
        name: "Update my profile",
        method: "PATCH",
        path: "/users/me",
        auth: "memberToken",
        json: { name: "Rahim Uddin", avatarUrl: "https://example.com/avatars/rahim.png" },
        expect: 200,
        description:
          "Any role. Only `name` and `avatarUrl` can be changed; any other field (for example `role`) is a 400.",
      },
      {
        name: "Get my profile – no token",
        method: "GET",
        path: "/users/me",
        expect: 401,
        description: "Without `Authorization: Bearer <token>` every protected route answers 401.",
      },
    ],
  },
  {
    name: "3. Projects & members",
    description:
      "Managers own projects (their workspace); members see only projects they were added to. FREE plan: 2 active projects and 3 members per project. Admins get 403 here (tenant privacy).",
    items: [
      {
        name: "Create project",
        method: "POST",
        path: "/projects",
        auth: "newManagerToken",
        json: {
          name: "Mobile App Launch",
          description: "Ship the TaskNest mobile app to the Play Store and App Store.",
          dueDate: "{{dueDate}}",
        },
        expect: 201,
        save: { projectId: "id" },
        description:
          "MANAGER. `dueDate` is optional (ISO 8601, not in the past). Checks the plan limit inside a transaction that locks the manager's row.",
      },
      {
        name: "Create project – validation error",
        method: "POST",
        path: "/projects",
        auth: "newManagerToken",
        json: { name: "X", dueDate: "2020-01-01" },
        expect: 400,
        description: "Name too short and a due date in the past.",
      },
      {
        name: "Member cannot create a project",
        method: "POST",
        path: "/projects",
        auth: "memberToken",
        json: { name: "Not allowed" },
        expect: 403,
        description: "Role check: only MANAGER may create projects.",
      },
      {
        name: "List my projects",
        method: "GET",
        path: "/projects",
        auth: "newManagerToken",
        query: {
          page: "1",
          limit: "10",
          search: "mobile",
          status: "ACTIVE",
          sortBy: "createdAt",
          sortOrder: "desc",
        },
        expect: 200,
        description:
          "MANAGER (own projects) or MEMBER (joined projects). Pagination `page`/`limit` (max 100), `search` in name/description, `status` ACTIVE/ARCHIVED, `sortBy` createdAt/name/dueDate, `sortOrder` asc/desc.",
      },
      {
        name: "Get project with stats",
        method: "GET",
        path: "/projects/{{projectId}}",
        auth: "newManagerToken",
        expect: 200,
        description:
          "Owner or member. Includes stats: tasks by status, overdue tasks, progress % and member count (cached for 5 minutes when Redis is configured).",
      },
      {
        name: "Update project",
        method: "PATCH",
        path: "/projects/{{projectId}}",
        auth: "newManagerToken",
        json: {
          description: "Ship the TaskNest mobile app to both app stores before the deadline.",
        },
        expect: 200,
        description:
          "Owner. Any of `name`, `description`, `dueDate`, `status` (ACTIVE or ARCHIVED; an archived project is read-only).",
      },
      {
        name: "Add member by email",
        method: "POST",
        path: "/projects/{{projectId}}/members",
        auth: "newManagerToken",
        json: { email: "{{newMemberEmail}}" },
        expect: 201,
        description:
          "Owner. The user must exist, be ACTIVE and have the MEMBER role. FREE plan: 3 members per project (402 above that).",
      },
      {
        name: "Add a second member",
        method: "POST",
        path: "/projects/{{projectId}}/members",
        auth: "newManagerToken",
        json: { email: "karim@tasknest.com" },
        expect: 201,
        save: { karimId: "id" },
        description: "Owner. Adds the seeded member Karim.",
      },
      {
        name: "Add the same member again",
        method: "POST",
        path: "/projects/{{projectId}}/members",
        auth: "newManagerToken",
        json: { email: "karim@tasknest.com" },
        expect: 409,
        description: "A member cannot be added twice.",
      },
      {
        name: "List members",
        method: "GET",
        path: "/projects/{{projectId}}/members",
        auth: "newManagerToken",
        expect: 200,
        description: "Owner or member.",
      },
      {
        name: "Remove member",
        method: "DELETE",
        path: "/projects/{{projectId}}/members/{{karimId}}",
        auth: "newManagerToken",
        expect: 200,
        description:
          "Owner. In the same transaction, the member's unfinished tasks in this project become unassigned and go back to TODO.",
      },
      {
        name: "Another team's project is hidden",
        method: "GET",
        path: "/projects/{{projectId}}",
        auth: "memberToken",
        expect: 404,
        description:
          "Rahim is not in this project, so it does not exist for him (404, not 403, so ids of other workspaces are not revealed).",
      },
      {
        name: "Create a project to delete",
        method: "POST",
        path: "/projects",
        auth: "newManagerToken",
        json: { name: "Old Landing Page" },
        expect: 201,
        save: { tempProjectId: "id" },
        description: "MANAGER. Used by the delete request below.",
      },
      {
        name: "Delete project (soft delete)",
        method: "DELETE",
        path: "/projects/{{tempProjectId}}",
        auth: "newManagerToken",
        expect: 200,
        description:
          "Owner. Sets `deletedAt` on the project and all its tasks in one transaction; nothing is removed from the database.",
      },
      {
        name: "Deleted project is gone",
        method: "GET",
        path: "/projects/{{tempProjectId}}",
        auth: "newManagerToken",
        expect: 404,
        description: "Soft-deleted records are hidden everywhere.",
      },
    ],
  },
  {
    name: "4. Tasks & comments",
    description:
      "Workflow: TODO → IN_PROGRESS → IN_REVIEW → DONE. The assignee may move TODO ↔ IN_PROGRESS → IN_REVIEW; only the project owner approves (DONE), sends back or reopens.",
    items: [
      {
        name: "Create task",
        method: "POST",
        path: "/projects/{{projectId}}/tasks",
        auth: "newManagerToken",
        json: {
          title: "Design onboarding screens",
          description: "Three screens: welcome, sign-in, first project.",
          priority: "HIGH",
          dueDate: "{{dueDate}}",
          assigneeId: "{{newMemberId}}",
        },
        expect: 201,
        save: { taskId: "id" },
        description:
          "Project owner. `priority` LOW/MEDIUM/HIGH/URGENT (default MEDIUM). `assigneeId` must be a member of the project.",
      },
      {
        name: "Create an unassigned task",
        method: "POST",
        path: "/projects/{{projectId}}/tasks",
        auth: "newManagerToken",
        json: { title: "Write the store listing text", priority: "LOW" },
        expect: 201,
        save: { task2Id: "id" },
        description: "Project owner. Without `assigneeId` the task stays unassigned.",
      },
      {
        name: "List tasks with filters",
        method: "GET",
        path: "/tasks",
        auth: "newManagerToken",
        query: {
          projectId: "{{projectId}}",
          status: "TODO",
          priority: "HIGH",
          search: "onboarding",
          sortBy: "dueDate",
          sortOrder: "asc",
          page: "1",
          limit: "10",
        },
        expect: 200,
        description:
          "MANAGER or MEMBER: tasks of their projects. Filters `projectId`, `status`, `priority`, `assigneeId`, `overdue=true`, `search` (title/description); `sortBy` createdAt/dueDate/priority/title.",
      },
      {
        name: "Overdue tasks",
        method: "GET",
        path: "/tasks",
        auth: "managerToken",
        query: { overdue: "true" },
        expect: 200,
        description: "Overdue = due date in the past and not DONE.",
      },
      {
        name: "My assigned tasks",
        method: "GET",
        path: "/tasks/my-assigned",
        auth: "newMemberToken",
        query: { status: "TODO", sortBy: "dueDate", sortOrder: "asc" },
        expect: 200,
        description: "MEMBER. Tasks assigned to me in all my projects.",
      },
      {
        name: "Get task",
        method: "GET",
        path: "/tasks/{{taskId}}",
        auth: "newMemberToken",
        expect: 200,
        description:
          "Owner or member. Includes `isOverdue`, `commentCount` and `nextStatuses` (the moves you may make).",
      },
      {
        name: "Update task",
        method: "PATCH",
        path: "/tasks/{{taskId}}",
        auth: "newManagerToken",
        json: {
          priority: "URGENT",
          description:
            "Three screens: welcome, sign-in and the first project. Use the new colours.",
        },
        expect: 200,
        description: "Project owner. Any of `title`, `description`, `priority`, `dueDate`.",
      },
      {
        name: "Member starts work (TODO → IN_PROGRESS)",
        method: "PATCH",
        path: "/tasks/{{taskId}}/status",
        auth: "newMemberToken",
        json: { status: "IN_PROGRESS" },
        expect: 200,
        description: "Assignee or owner.",
      },
      {
        name: "Member submits for review (IN_PROGRESS → IN_REVIEW)",
        method: "PATCH",
        path: "/tasks/{{taskId}}/status",
        auth: "newMemberToken",
        json: { status: "IN_REVIEW" },
        expect: 200,
        description: "Assignee or owner.",
      },
      {
        name: "Member cannot approve (IN_REVIEW → DONE)",
        method: "PATCH",
        path: "/tasks/{{taskId}}/status",
        auth: "newMemberToken",
        json: { status: "DONE" },
        expect: 403,
        description: "Only the project owner approves work.",
      },
      {
        name: "Manager approves (IN_REVIEW → DONE)",
        method: "PATCH",
        path: "/tasks/{{taskId}}/status",
        auth: "newManagerToken",
        json: { status: "DONE" },
        expect: 200,
        description: "Owner. Sets `completedAt`.",
      },
      {
        name: "Invalid move (DONE → TODO)",
        method: "PATCH",
        path: "/tasks/{{taskId}}/status",
        auth: "newManagerToken",
        json: { status: "TODO" },
        expect: 409,
        description: "Moves outside the workflow table answer 409.",
      },
      {
        name: "Assign task",
        method: "PATCH",
        path: "/tasks/{{task2Id}}/assign",
        auth: "newManagerToken",
        json: { assigneeId: "{{newMemberId}}" },
        expect: 200,
        description:
          "Project owner. The assignee must be an active member; DONE tasks cannot be reassigned.",
      },
      {
        name: "Unassign task",
        method: "PATCH",
        path: "/tasks/{{task2Id}}/assign",
        auth: "newManagerToken",
        json: { assigneeId: null },
        expect: 200,
        description: "Project owner. `null` unassigns; allowed only while the task is TODO.",
      },
      {
        name: "Add comment",
        method: "POST",
        path: "/tasks/{{taskId}}/comments",
        auth: "newMemberToken",
        json: { body: "Screens are in the design folder. Ready for your review." },
        expect: 201,
        description: "Owner or member of the project. 1–2000 characters.",
      },
      {
        name: "List comments",
        method: "GET",
        path: "/tasks/{{taskId}}/comments",
        auth: "newManagerToken",
        query: { page: "1", limit: "10" },
        expect: 200,
        description: "Owner or member. Oldest first, paginated.",
      },
      {
        name: "Delete task (soft delete)",
        method: "DELETE",
        path: "/tasks/{{task2Id}}",
        auth: "newManagerToken",
        expect: 200,
        description: "Project owner. Sets `deletedAt`.",
      },
    ],
  },
  {
    name: "5. Payments (SSLCommerz)",
    description:
      "PRO plan: 500 BDT for 30 days, no project or member limits.\n\nReal flow: 1) `Start PRO payment` returns `paymentUrl`; 2) open it in a browser and pay with an SSLCommerz sandbox card; 3) SSLCommerz redirects to `/payments/success` and also calls `/payments/ipn`; 4) TaskNest checks `val_id` with the SSLCommerz validation API (status, tran_id, amount, currency) and only then marks the payment PAID and extends the plan, once, in one transaction.\n\nThe callback requests here show what SSLCommerz sends. Called by hand they only succeed with a real `val_id` from a sandbox payment.",
    items: [
      {
        name: "Create a second active project",
        method: "POST",
        path: "/projects",
        auth: "newManagerToken",
        json: { name: "Marketing Website" },
        expect: 201,
        description: "MANAGER. The FREE plan allows 2 active projects.",
      },
      {
        name: "FREE limit reached (402)",
        method: "POST",
        path: "/projects",
        auth: "newManagerToken",
        json: { name: "Customer Portal" },
        expect: [402, 201],
        description: "A third active project on the FREE plan answers 402 Payment Required.",
      },
      {
        name: "Start PRO payment",
        method: "POST",
        path: "/payments/initiate",
        auth: "newManagerToken",
        json: { plan: "PRO" },
        expect: [201, 503],
        save: { paymentId: "payment.id", tranId: "payment.tranId" },
        description:
          "MANAGER. Saves a PENDING payment (amount from the server: 500.00 BDT) and opens an SSLCommerz session. Open `paymentUrl` in a browser to pay. 503 when the store is not configured.",
      },
      {
        name: "Success callback (SSLCommerz)",
        method: "POST",
        path: "/payments/success",
        form: { tran_id: "{{tranId}}", val_id: "{{valId}}", status: "VALID", amount: "500.00" },
        expect: [200, 400],
        description:
          "Public, called by SSLCommerz (browser redirect). Validated server-to-server with `val_id`; replays and the IPN never extend the plan twice. Set `valId` to the `val_id` SSLCommerz sent to try it by hand.",
      },
      {
        name: "Project creation works on PRO",
        method: "POST",
        path: "/projects",
        auth: "newManagerToken",
        json: { name: "Customer Portal" },
        expect: [201, 402],
        description: "After the payment the limit is gone.",
      },
      {
        name: "Start a payment to cancel",
        method: "POST",
        path: "/payments/initiate",
        auth: "newManagerToken",
        json: {},
        expect: [201, 503],
        save: { cancelTranId: "payment.tranId" },
        description: "MANAGER. A second payment, used by the cancel callback below.",
      },
      {
        name: "Cancel callback (SSLCommerz)",
        method: "POST",
        path: "/payments/cancel",
        form: { tran_id: "{{cancelTranId}}", status: "CANCELLED" },
        expect: [200, 400, 404],
        description: "Public, called by SSLCommerz when the customer cancels. PENDING → CANCELLED.",
      },
      {
        name: "Start a payment that fails",
        method: "POST",
        path: "/payments/initiate",
        auth: "newManagerToken",
        json: {},
        expect: [201, 503],
        save: { failTranId: "payment.tranId" },
        description: "MANAGER. A third payment, used by the fail callback below.",
      },
      {
        name: "Fail callback (SSLCommerz)",
        method: "POST",
        path: "/payments/fail",
        form: { tran_id: "{{failTranId}}", status: "FAILED", error: "Card declined" },
        expect: [200, 400, 404],
        description:
          "Public, called by SSLCommerz when the payment fails. PENDING → FAILED. Fail/cancel can never set PAID.",
      },
      {
        name: "IPN (SSLCommerz server-to-server)",
        method: "POST",
        path: "/payments/ipn",
        form: { tran_id: "{{tranId}}", val_id: "{{valId}}", status: "VALID" },
        expect: [200, 400, 404],
        description:
          "Public, called by SSLCommerz in the background (needs a public URL). Same validation as the success callback; idempotent.",
      },
      {
        name: "Client cannot set the amount",
        method: "POST",
        path: "/payments/initiate",
        auth: "newManagerToken",
        json: { amount: 1 },
        expect: 400,
        description: "The price comes from the server only.",
      },
      {
        name: "Member cannot pay",
        method: "POST",
        path: "/payments/initiate",
        auth: "memberToken",
        json: {},
        expect: 403,
        description: "Only managers buy the PRO plan.",
      },
      {
        name: "My payment history",
        method: "GET",
        path: "/payments",
        auth: "newManagerToken",
        query: { page: "1", limit: "10" },
        expect: 200,
        description: "MANAGER: own payments. ADMIN: all payments (filters `status`, `userId`).",
      },
      {
        name: "Get payment status",
        method: "GET",
        path: "/payments/{{paymentId}}",
        auth: "newManagerToken",
        expect: [200, 400],
        description: "MANAGER (own payment, else 404) or ADMIN.",
      },
    ],
  },
  {
    name: "6. Admin",
    description: "ADMIN only (managers and members get 403).",
    items: [
      {
        name: "List users",
        method: "GET",
        path: "/admin/users",
        auth: "adminToken",
        query: {
          search: "postman",
          role: "MEMBER",
          status: "ACTIVE",
          sortBy: "createdAt",
          sortOrder: "desc",
          page: "1",
          limit: "10",
        },
        expect: 200,
        description:
          "`search` in name/email, filters `role` and `status`, `sortBy` createdAt/name/email, pagination.",
      },
      {
        name: "Promote member to MANAGER",
        method: "PATCH",
        path: "/admin/users/{{extraMemberId}}/role",
        auth: "adminToken",
        json: { role: "MANAGER" },
        expect: 200,
        description:
          "Only MANAGER ↔ MEMBER. A member who is still in projects cannot become a manager (409). Written to the audit log.",
      },
      {
        name: "Role change blocked – still owns projects",
        method: "PATCH",
        path: "/admin/users/{{newManagerId}}/role",
        auth: "adminToken",
        json: { role: "MEMBER" },
        expect: 409,
        description: "A manager who still owns projects cannot become a member.",
      },
      {
        name: "Block user",
        method: "PATCH",
        path: "/admin/users/{{extraMemberId}}/status",
        auth: "adminToken",
        json: { status: "BLOCKED" },
        expect: 200,
        description:
          "Blocked users cannot log in, and their existing tokens stop working at once (all refresh tokens are revoked). Admins cannot block themselves or other admins.",
      },
      {
        name: "Unblock user",
        method: "PATCH",
        path: "/admin/users/{{extraMemberId}}/status",
        auth: "adminToken",
        json: { status: "ACTIVE" },
        expect: 200,
        description: "The user can log in again.",
      },
      {
        name: "Manager cannot use admin APIs",
        method: "GET",
        path: "/admin/users",
        auth: "managerToken",
        expect: 403,
        description: "Role check on every admin route.",
      },
      {
        name: "Dashboard stats",
        method: "GET",
        path: "/admin/stats",
        auth: "adminToken",
        expect: 200,
        description:
          "Users by role, blocked users, projects, tasks by status, overdue tasks, payments by status, revenue and active PRO managers. Cached for 60 seconds when Redis is configured.",
      },
      {
        name: "Audit logs",
        method: "GET",
        path: "/admin/audit-logs",
        auth: "adminToken",
        query: {
          action: "TASK_STATUS_CHANGED",
          entityType: "TASK",
          sortOrder: "desc",
          page: "1",
          limit: "10",
        },
        expect: 200,
        description:
          "Who changed what. Filters `action`, `entityType`, `entityId`, `actorId`, `from`, `to` (ISO dates).",
      },
      {
        name: "All payments (admin)",
        method: "GET",
        path: "/payments",
        auth: "adminToken",
        query: { status: "PAID", page: "1", limit: "10" },
        expect: 200,
        description: "ADMIN sees every manager's payments.",
      },
    ],
  },
  {
    name: "7. Errors",
    description: "Every error uses the same shape: `{ success: false, message, errors }`.",
    items: [
      {
        name: "Unknown route",
        method: "GET",
        path: "/does-not-exist",
        expect: 404,
        description: "Any route that does not exist.",
      },
      {
        name: "Malformed JSON",
        method: "POST",
        path: "/auth/login",
        rawBody: '{"email": "manager@tasknest.com", ',
        expect: 400,
        description: "A body that is not valid JSON.",
      },
      {
        name: "Invalid id",
        method: "GET",
        path: "/projects/not-a-uuid",
        auth: "managerToken",
        expect: 400,
        description: "Ids are UUIDs; anything else is a validation error, never a database error.",
      },
    ],
  },
  {
    name: "8. Logout",
    description: "Ends the sessions of the logged-in user.",
    items: [
      {
        name: "Logout",
        method: "POST",
        path: "/auth/logout",
        auth: "managerToken",
        expect: 200,
        description: "Any role. Revokes all refresh tokens of the user (logout from every device).",
      },
      {
        name: "Refresh after logout fails",
        method: "POST",
        path: "/auth/refresh-token",
        json: { refreshToken: "{{managerRefreshToken}}" },
        expect: 401,
        description: "The revoked refresh token no longer works.",
      },
    ],
  },
];
