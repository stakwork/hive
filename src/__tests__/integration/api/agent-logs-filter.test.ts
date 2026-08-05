/**
 * Integration tests for GET /api/agent-logs — agent name filter
 *
 * Covers:
 * — ?agent=coding matches rows via `source` field
 * — ?agent=research matches rows via `agent` field
 * — Matching is case-insensitive
 * — Absent/empty agent param returns the full unfiltered set
 * — agent filter composes with start_date/end_date (AND semantics)
 * — agent filter composes with task_id relation filter (OR doesn't widen)
 * — agent + search combination: total/hasMore reflect DB-level agent-filtered
 *   count while the returned data array is further narrowed by in-memory blob search
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { createAuthenticatedGetRequest } from "@/__tests__/support/helpers";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
} from "@/__tests__/support/factories";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

// ── Blob-fetch mock (avoids real network calls for the search path) ────────────
vi.mock("@/lib/utils/blob-fetch", () => ({
  fetchBlobContent: vi.fn().mockImplementation((url: string) => {
    // Return content keyed to the blob URL so tests can control per-log content
    return Promise.resolve(blobContentMap.get(url) ?? "no content");
  }),
}));

/** Mutable map populated by individual tests to control blob content per log */
const blobContentMap = new Map<string, string>();

// Route import after mocks
import { GET } from "@/app/api/agent-logs/route";

// ── Setup / teardown ──────────────────────────────────────────────────────────

type TestFixture = {
  user: { id: string; email: string; name: string | null };
  workspace: { id: string };
  logIds: string[];
};

async function createFixture(): Promise<TestFixture> {
  const user = await createTestUser({
    email: `agent-filter-${generateUniqueId("u")}@example.com`,
  });

  const workspace = await createTestWorkspace({
    slug: `agent-filter-${generateUniqueId("ws")}`,
    ownerId: user.id,
  });

  // Workspace owner membership (OWNER role → canRead)
  await createTestMembership({
    workspaceId: workspace.id,
    userId: user.id,
    role: "OWNER",
  });

  return { user, workspace, logIds: [] };
}

async function seedLog(
  workspaceId: string,
  opts: {
    agent: string;
    source?: string;
    blobContent?: string;
    taskId?: string;
    createdAt?: Date;
  },
): Promise<string> {
  const blobUrl = `https://blob.example.com/log-${generateUniqueId("blob")}.json`;
  if (opts.blobContent !== undefined) {
    blobContentMap.set(blobUrl, opts.blobContent);
  }

  const log = await db.agentLog.create({
    data: {
      id: generateUniqueId("log"),
      workspaceId,
      agent: opts.agent,
      source: opts.source ?? null,
      blobUrl,
      taskId: opts.taskId ?? null,
      createdAt: opts.createdAt,
    },
  });
  return log.id;
}

async function cleanup(fixture: TestFixture) {
  if (fixture.logIds.length) {
    await db.agentLog.deleteMany({ where: { id: { in: fixture.logIds } } });
  }
  // Delete all logs for the workspace (catch-all for logs created during tests)
  await db.agentLog.deleteMany({ where: { workspaceId: fixture.workspace.id } });
  await db.workspaceMember.deleteMany({ where: { workspaceId: fixture.workspace.id } });
  await db.workspace.deleteMany({ where: { id: fixture.workspace.id } });
  await db.user.deleteMany({ where: { id: fixture.user.id } });
  blobContentMap.clear();
}

function buildRequest(fixture: TestFixture, params: Record<string, string>) {
  const url = "/api/agent-logs";
  return createAuthenticatedGetRequest(
    url,
    { id: fixture.user.id, email: fixture.user.email, name: fixture.user.name },
    { workspace_id: fixture.workspace.id, ...params },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/agent-logs — agent name filter", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    vi.clearAllMocks();
    fixture = await createFixture();
  });

  afterEach(async () => {
    await cleanup(fixture);
  });

  test("?agent=coding matches rows whose source contains 'coding' (case-insensitive)", async () => {
    await seedLog(fixture.workspace.id, { agent: "plan-agent", source: "coding-agent" });
    await seedLog(fixture.workspace.id, { agent: "plan-agent", source: "build-agent" });

    const req = buildRequest(fixture, { agent: "coding" });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].source).toBe("coding-agent");
    expect(body.total).toBe(1);
  });

  test("?agent=research matches rows whose agent field contains 'research'", async () => {
    await seedLog(fixture.workspace.id, { agent: "researcher", source: "coding-agent" });
    await seedLog(fixture.workspace.id, { agent: "planner", source: "build-agent" });

    const req = buildRequest(fixture, { agent: "research" });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].agent).toBe("researcher");
    expect(body.total).toBe(1);
  });

  test("matching is case-insensitive: ?agent=CODING matches source='coding-agent'", async () => {
    await seedLog(fixture.workspace.id, { agent: "plan-agent", source: "coding-agent" });
    await seedLog(fixture.workspace.id, { agent: "plan-agent", source: "build-agent" });

    const req = buildRequest(fixture, { agent: "CODING" });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].source).toBe("coding-agent");
  });

  test("absent agent param returns the full unfiltered set", async () => {
    await seedLog(fixture.workspace.id, { agent: "researcher", source: "coding-agent" });
    await seedLog(fixture.workspace.id, { agent: "planner", source: "build-agent" });
    await seedLog(fixture.workspace.id, { agent: "security-bot", source: "security-review-agent" });

    const req = buildRequest(fixture, {});
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(3);
    expect(body.total).toBe(3);
  });

  test("empty agent param (?agent=) returns the full unfiltered set", async () => {
    await seedLog(fixture.workspace.id, { agent: "researcher", source: "coding-agent" });
    await seedLog(fixture.workspace.id, { agent: "planner", source: "build-agent" });

    const req = buildRequest(fixture, { agent: "" });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  test("agent filter matches on both agent and source fields (OR semantics)", async () => {
    // 'push' appears in agent on first row, in source on second
    await seedLog(fixture.workspace.id, { agent: "push-helper", source: "build-agent" });
    await seedLog(fixture.workspace.id, { agent: "planner", source: "push-agent" });
    await seedLog(fixture.workspace.id, { agent: "security-bot", source: "security-review-agent" });

    const req = buildRequest(fixture, { agent: "push" });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(2);
    const agents = body.data.map((d: { agent: string }) => d.agent);
    expect(agents).toContain("push-helper");
    expect(agents).toContain("planner");
  });

  test("agent filter composes with start_date/end_date (AND semantics)", async () => {
    const past = new Date("2024-01-01T00:00:00Z");
    const recent = new Date("2025-06-01T00:00:00Z");

    await seedLog(fixture.workspace.id, { agent: "researcher", source: "coding-agent", createdAt: past });
    await seedLog(fixture.workspace.id, { agent: "researcher", source: "coding-agent", createdAt: recent });
    await seedLog(fixture.workspace.id, { agent: "planner", source: "build-agent", createdAt: recent });

    // Filter: agent contains 'coding' AND created after 2025-01-01 → only the recent coding log
    const req = buildRequest(fixture, {
      agent: "coding",
      start_date: "2025-01-01T00:00:00Z",
    });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].source).toBe("coding-agent");
    expect(new Date(body.data[0].createdAt).getFullYear()).toBe(2025);
    expect(body.total).toBe(1);
  });

  test("agent filter composes with task_id relation filter — OR doesn't widen relation scope", async () => {
    // Create a task to attach some logs to
    const taskId = generateUniqueId("task");
    const owner = await db.user.findUniqueOrThrow({ where: { id: fixture.user.id } });
    await db.task.create({
      data: {
        id: taskId,
        title: "Filter Test Task",
        workspaceId: fixture.workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    try {
      // Log for the task with matching source
      await seedLog(fixture.workspace.id, { agent: "planner", source: "coding-agent", taskId });
      // Log for the task with non-matching source
      await seedLog(fixture.workspace.id, { agent: "planner", source: "build-agent", taskId });
      // Log NOT for this task but with matching source
      await seedLog(fixture.workspace.id, { agent: "planner", source: "coding-agent" });

      const req = buildRequest(fixture, { agent: "coding", task_id: taskId });
      const res = await GET(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      // Only the task log whose source matches — OR doesn't pull in the non-task log
      expect(body.data).toHaveLength(1);
      expect(body.data[0].taskId).toBe(taskId);
      expect(body.data[0].source).toBe("coding-agent");
      expect(body.total).toBe(1);
    } finally {
      await db.agentLog.deleteMany({ where: { taskId } });
      await db.task.deleteMany({ where: { id: taskId } });
    }
  });

  test("agent + search combination: total reflects DB agent-filtered count; data is further narrowed by blob search", async () => {
    // Two logs match agent filter (source contains 'coding')
    // Only one of those has blob content matching the search term
    await seedLog(fixture.workspace.id, {
      agent: "plan-agent",
      source: "coding-agent",
      blobContent: "important deployment step",
    });
    await seedLog(fixture.workspace.id, {
      agent: "plan-agent",
      source: "coding-agent",
      blobContent: "routine build output",
    });
    // Log that doesn't match agent filter at all
    await seedLog(fixture.workspace.id, {
      agent: "security-bot",
      source: "security-review-agent",
      blobContent: "important deployment step",
    });

    const req = buildRequest(fixture, { agent: "coding", search: "important" });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    // data is narrowed by blob search: only the log with "important" in blob content
    expect(body.data).toHaveLength(1);
    expect(body.data[0].source).toBe("coding-agent");
    // total is the DB-level agent-filtered count (2), not the post-search count
    expect(body.total).toBe(2);
  });
});
