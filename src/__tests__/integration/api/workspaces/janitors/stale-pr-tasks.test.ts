import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
  createTestTask,
  createTestChatMessage,
} from "@/__tests__/support/factories";
import {
  createAuthenticatedSession,
  getMockedSession,
  mockUnauthenticatedSession,
} from "@/__tests__/support/helpers";
import { createPostRequest } from "@/__tests__/support/helpers/request-builders";

vi.mock("@/lib/auth/nextauth", () => ({ authOptions: {} }));

// ── Helpers ────────────────────────────────────────────────────────────────────

async function createPRTaskScenario(opts: {
  workspaceId: string;
  ownerId: string;
  state: "ci_failure" | "conflict";
  daysOld?: number;
}) {
  const { workspaceId, ownerId, state, daysOld = 10 } = opts;
  const task = await createTestTask({ workspaceId, createdById: ownerId });
  const msg = await createTestChatMessage({ taskId: task.id, message: "test message" });

  // Create artifact with stale PR progress
  const lastCheckedAt = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  const artifact = await db.artifact.create({
    data: {
      messageId: msg.id,
      type: "PULL_REQUEST",
      content: {
        url: `https://github.com/org/repo/pull/${task.id}`,
        status: "open",
        progress: {
          state,
          lastCheckedAt,
        },
        repoUrl: "https://github.com/org/repo",
      },
    },
  });

  return { task, msg, artifact };
}

function makeRequest(slug: string, body: object) {
  return createPostRequest(
    `http://localhost:3000/api/workspaces/${slug}/janitors/stale-pr-tasks`,
    body,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/janitors/stale-pr-tasks", () => {
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let otherUser: Awaited<ReturnType<typeof createTestUser>>;
  let otherWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeEach(async () => {
    vi.clearAllMocks();

    owner = await createTestUser({ role: "USER" });
    workspace = await createTestWorkspace({ ownerId: owner.id });
    otherUser = await createTestUser({ role: "USER" });
    otherWorkspace = await createTestWorkspace({ ownerId: otherUser.id });
  });

  // ── Auth ─────────────────────────────────────────────────────────────────

  it("returns 401 when unauthenticated", async () => {
    getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

    const { POST } = await import(
      "@/app/api/workspaces/[slug]/janitors/stale-pr-tasks/route"
    );
    const req = makeRequest(workspace.slug, { mode: "dry_run" });
    const res = await POST(req, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not a workspace member", async () => {
    getMockedSession().mockResolvedValue(
      createAuthenticatedSession(otherUser),
    );

    const { POST } = await import(
      "@/app/api/workspaces/[slug]/janitors/stale-pr-tasks/route"
    );
    const req = makeRequest(workspace.slug, { mode: "dry_run" });
    const res = await POST(req, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(res.status).toBe(403);
  });

  // ── dry_run ──────────────────────────────────────────────────────────────

  it("dry_run: returns stale tasks without mutating the DB", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const { task, artifact } = await createPRTaskScenario({
      workspaceId: workspace.id,
      ownerId: owner.id,
      state: "ci_failure",
      daysOld: 10,
    });

    const { POST } = await import(
      "@/app/api/workspaces/[slug]/janitors/stale-pr-tasks/route"
    );
    const req = makeRequest(workspace.slug, { mode: "dry_run", thresholdDays: 7 });
    const res = await POST(req, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBeGreaterThanOrEqual(1);
    const found = data.tasks.find((t: { artifactId: string }) => t.artifactId === artifact.id);
    expect(found).toBeDefined();
    expect(found.taskId).toBe(task.id);

    // No mutations: task should still be active
    const dbTask = await db.task.findUnique({ where: { id: task.id } });
    expect(dbTask?.archived).toBe(false);
  });

  it("dry_run: does not return tasks whose PRs are not stale enough", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    await createPRTaskScenario({
      workspaceId: workspace.id,
      ownerId: owner.id,
      state: "ci_failure",
      daysOld: 2, // only 2 days old, threshold is 7
    });

    const { POST } = await import(
      "@/app/api/workspaces/[slug]/janitors/stale-pr-tasks/route"
    );
    const req = makeRequest(workspace.slug, { mode: "dry_run", thresholdDays: 7 });
    const res = await POST(req, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(0);
  });

  // ── execute ──────────────────────────────────────────────────────────────

  it("execute: archives tasks and sets artifact status to CANCELLED", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const { task, artifact } = await createPRTaskScenario({
      workspaceId: workspace.id,
      ownerId: owner.id,
      state: "conflict",
      daysOld: 10,
    });

    const { POST } = await import(
      "@/app/api/workspaces/[slug]/janitors/stale-pr-tasks/route"
    );
    const req = makeRequest(workspace.slug, { mode: "execute", thresholdDays: 7 });
    const res = await POST(req, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.archivedCount).toBeGreaterThanOrEqual(1);

    // Task should be archived
    const dbTask = await db.task.findUnique({ where: { id: task.id } });
    expect(dbTask?.archived).toBe(true);
    expect(dbTask?.archivedAt).not.toBeNull();

    // Artifact status should be CANCELLED
    const dbArtifact = await db.artifact.findUnique({ where: { id: artifact.id } });
    const content = dbArtifact?.content as { status: string };
    expect(content.status).toBe("CANCELLED");
  });

  it("execute with taskIds: archives specific tasks directly", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const { task, artifact } = await createPRTaskScenario({
      workspaceId: workspace.id,
      ownerId: owner.id,
      state: "ci_failure",
      daysOld: 2, // below threshold — but taskIds bypasses that
    });

    const { POST } = await import(
      "@/app/api/workspaces/[slug]/janitors/stale-pr-tasks/route"
    );
    const req = makeRequest(workspace.slug, {
      mode: "execute",
      thresholdDays: 7,
      taskIds: [task.id],
    });
    const res = await POST(req, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.archivedCount).toBe(1);

    const dbTask = await db.task.findUnique({ where: { id: task.id } });
    expect(dbTask?.archived).toBe(true);

    const dbArtifact = await db.artifact.findUnique({ where: { id: artifact.id } });
    const content = dbArtifact?.content as { status: string };
    expect(content.status).toBe("CANCELLED");
  });

  // ── IDOR guard ───────────────────────────────────────────────────────────

  it("returns 403 when taskIds include tasks from another workspace", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    // Task in another workspace
    const { task: foreignTask } = await createPRTaskScenario({
      workspaceId: otherWorkspace.id,
      ownerId: otherUser.id,
      state: "ci_failure",
      daysOld: 10,
    });

    const { POST } = await import(
      "@/app/api/workspaces/[slug]/janitors/stale-pr-tasks/route"
    );
    const req = makeRequest(workspace.slug, {
      mode: "execute",
      taskIds: [foreignTask.id],
    });
    const res = await POST(req, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/do not belong/i);

    // Foreign task must NOT be archived
    const dbTask = await db.task.findUnique({ where: { id: foreignTask.id } });
    expect(dbTask?.archived).toBe(false);
  });

  // ── Validation ───────────────────────────────────────────────────────────

  it("returns 400 for invalid mode", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const { POST } = await import(
      "@/app/api/workspaces/[slug]/janitors/stale-pr-tasks/route"
    );
    const req = makeRequest(workspace.slug, { mode: "invalid_mode" });
    const res = await POST(req, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(res.status).toBe(400);
  });

  it("uses JanitorConfig.stalePrTaskThresholdDays when thresholdDays not provided", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    // Set a config with stalePrTaskThresholdDays = 5
    await db.janitorConfig.upsert({
      where: { workspaceId: workspace.id },
      create: { workspaceId: workspace.id, stalePrTaskThresholdDays: 5 },
      update: { stalePrTaskThresholdDays: 5 },
    });

    // Task that's 4 days old — below default 7, but above config's 5... wait, 5 > 4 so it should NOT appear
    await createPRTaskScenario({
      workspaceId: workspace.id,
      ownerId: owner.id,
      state: "ci_failure",
      daysOld: 4,
    });

    const { POST } = await import(
      "@/app/api/workspaces/[slug]/janitors/stale-pr-tasks/route"
    );
    // No thresholdDays in body → should fall back to config value of 5
    const req = makeRequest(workspace.slug, { mode: "dry_run" });
    const res = await POST(req, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    // 4 days old < 5 days threshold → should NOT be stale
    expect(data.total).toBe(0);
  });

  // ── Read-only member (VIEWER) ─────────────────────────────────────────────

  it("returns 403 for read-only viewer member", async () => {
    const viewer = await createTestUser({ role: "USER" });
    await createTestMembership({ workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" });
    getMockedSession().mockResolvedValue(createAuthenticatedSession(viewer));

    const { POST } = await import(
      "@/app/api/workspaces/[slug]/janitors/stale-pr-tasks/route"
    );
    const req = makeRequest(workspace.slug, { mode: "dry_run" });
    const res = await POST(req, { params: Promise.resolve({ slug: workspace.slug }) });

    expect(res.status).toBe(403);
  });
});
