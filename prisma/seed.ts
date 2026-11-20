/**
 * Demo data for TaskNest. Safe to run many times: every record is upserted,
 * so running it again resets the demo project to a known state.
 *
 *   npm run db:seed
 */
import { z } from "zod";
import type { Role, TaskPriority, TaskStatus } from "../src/generated/prisma/enums.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/utils/password.js";

const seedEnv = z
  .object({
    ADMIN_EMAIL: z.email({ error: "ADMIN_EMAIL must be a valid email" }),
    ADMIN_PASSWORD: z.string({ error: "ADMIN_PASSWORD is required" }).min(8),
  })
  .parse(process.env);

// Demo-only passwords (documented in the README for evaluators).
const MANAGER_PASSWORD = "Manager@123";
const MEMBER_PASSWORD = "Member@123";

// Fixed IDs keep the seed idempotent.
const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const TASK_IDS = [
  "b0000000-0000-4000-8000-000000000001",
  "b0000000-0000-4000-8000-000000000002",
  "b0000000-0000-4000-8000-000000000003",
  "b0000000-0000-4000-8000-000000000004",
  "b0000000-0000-4000-8000-000000000005",
] as const;
const COMMENT_IDS = [
  "c0000000-0000-4000-8000-000000000001",
  "c0000000-0000-4000-8000-000000000002",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

async function upsertUser(input: { name: string; email: string; password: string; role: Role }) {
  const email = input.email.toLowerCase();
  const passwordHash = await hashPassword(input.password);

  return prisma.user.upsert({
    where: { email },
    update: { name: input.name, role: input.role, status: "ACTIVE", passwordHash },
    create: { name: input.name, email, role: input.role, passwordHash },
    select: { id: true, email: true, role: true },
  });
}

async function main() {
  // 1. Users: one per role (+ a second member)
  const admin = await upsertUser({
    name: "Platform Admin",
    email: seedEnv.ADMIN_EMAIL,
    password: seedEnv.ADMIN_PASSWORD,
    role: "ADMIN",
  });
  const manager = await upsertUser({
    name: "Nadia Manager",
    email: "manager@tasknest.com",
    password: MANAGER_PASSWORD,
    role: "MANAGER",
  });
  const rahim = await upsertUser({
    name: "Rahim Uddin",
    email: "rahim@tasknest.com",
    password: MEMBER_PASSWORD,
    role: "MEMBER",
  });
  const karim = await upsertUser({
    name: "Karim Hasan",
    email: "karim@tasknest.com",
    password: MEMBER_PASSWORD,
    role: "MEMBER",
  });

  // 2. One active project owned by the manager
  const projectData = {
    name: "Website Redesign",
    description: "Redesign the company website: new homepage, navbar, contact form and content.",
    status: "ACTIVE" as const,
    dueDate: daysFromNow(30),
    deletedAt: null,
  };
  const project = await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: { ...projectData, ownerId: manager.id },
    create: { id: PROJECT_ID, ...projectData, ownerId: manager.id },
    select: { id: true, name: true },
  });

  // 3. Both members join the project
  for (const member of [rahim, karim]) {
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: member.id } },
      update: { removedAt: null },
      create: { projectId: project.id, userId: member.id },
    });
  }

  // 4. Five tasks: one in each status, plus one overdue task
  const tasks: Array<{
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    assigneeId: string | null;
    dueDate: Date;
    completedAt: Date | null;
  }> = [
    {
      title: "Design the new homepage layout",
      description: "Create the desktop and mobile layout for the new homepage.",
      status: "DONE",
      priority: "HIGH",
      assigneeId: rahim.id,
      dueDate: daysFromNow(-5),
      completedAt: daysFromNow(-6),
    },
    {
      title: "Build the responsive navbar",
      description: "Navbar with dropdown menus that works on mobile, tablet and desktop.",
      status: "IN_REVIEW",
      priority: "MEDIUM",
      assigneeId: karim.id,
      dueDate: daysFromNow(3),
      completedAt: null,
    },
    {
      title: "Connect the contact form to the API",
      description: "Send contact form messages to the backend and show success or error states.",
      status: "IN_PROGRESS",
      priority: "HIGH",
      assigneeId: rahim.id,
      dueDate: daysFromNow(5),
      completedAt: null,
    },
    {
      title: "Write content for the About page",
      description: "Company story, team section and mission statement.",
      status: "TODO",
      priority: "LOW",
      assigneeId: null,
      dueDate: daysFromNow(10),
      completedAt: null,
    },
    {
      title: "Fix broken footer links",
      description: "Several footer links return 404. Find and fix them.",
      status: "IN_PROGRESS",
      priority: "URGENT",
      assigneeId: karim.id,
      dueDate: daysFromNow(-2), // overdue on purpose
      completedAt: null,
    },
  ];

  for (const [index, task] of tasks.entries()) {
    const id = TASK_IDS[index] as string;
    await prisma.task.upsert({
      where: { id },
      update: { ...task, deletedAt: null },
      create: { id, ...task, projectId: project.id, createdById: manager.id },
    });
  }

  // 5. Two comments on the task that is waiting for review
  const reviewTaskId = TASK_IDS[1];
  const comments = [
    {
      authorId: karim.id,
      body: "The navbar is ready for review. I tested it on mobile and desktop.",
    },
    {
      authorId: manager.id,
      body: "Looks good. I will check the dropdown on Safari, then approve.",
    },
  ];
  for (const [index, comment] of comments.entries()) {
    const id = COMMENT_IDS[index] as string;
    await prisma.comment.upsert({
      where: { id },
      update: { body: comment.body },
      create: { id, taskId: reviewTaskId, ...comment },
    });
  }

  console.log("Seed complete:");
  for (const user of [admin, manager, rahim, karim]) {
    console.log(`  ${user.role.padEnd(7)} ${user.email}`);
  }
  console.log(
    `  Project "${project.name}" with ${tasks.length} tasks and ${comments.length} comments`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
