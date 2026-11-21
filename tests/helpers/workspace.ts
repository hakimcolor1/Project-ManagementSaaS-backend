import { expect } from "vitest";
import { api, bearer, loginAs } from "./factory.js";

export type Session = Awaited<ReturnType<typeof loginAs>>;

/** Creates a project through the API and returns its body. */
export async function createProject(token: string, body: Record<string, unknown> = {}) {
  const res = await api()
    .post("/api/v1/projects")
    .set(bearer(token))
    .send({ name: `Project ${Math.random().toString(36).slice(2, 8)}`, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; name: string; status: string };
}

export async function addMember(token: string, projectId: string, email: string) {
  const res = await api()
    .post(`/api/v1/projects/${projectId}/members`)
    .set(bearer(token))
    .send({ email });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

export async function createTask(
  token: string,
  projectId: string,
  body: Record<string, unknown> = {},
) {
  const res = await api()
    .post(`/api/v1/projects/${projectId}/tasks`)
    .set(bearer(token))
    .send({ title: "Write the landing page", ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; status: string; assignee: { id: string } | null };
}

export function moveTask(token: string, taskId: string, status: string) {
  return api().patch(`/api/v1/tasks/${taskId}/status`).set(bearer(token)).send({ status });
}

/** A manager with one project and one member in it. */
export async function setupTeam() {
  const manager = await loginAs("MANAGER");
  const member = await loginAs("MEMBER");
  const project = await createProject(manager.accessToken, { name: "Team project" });
  await addMember(manager.accessToken, project.id, member.user.email);
  return { manager, member, project };
}

export const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);
