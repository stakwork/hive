/**
 * Unit tests for `getUserActivityFeed` service.
 *
 * Mirrors the pattern from `src/__tests__/unit/api/profile-activity.test.ts`
 * but tests the service in isolation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    sharedConversation: { findMany: vi.fn() },
    workspace: { findMany: vi.fn() },
    sourceControlOrg: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    feature: { findMany: vi.fn() },
    milestone: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { getUserActivityFeed } from "@/services/roadmap/user-activity";
import { db } from "@/lib/db";

const mockedDb = db as unknown as {
  sharedConversation: { findMany: ReturnType<typeof vi.fn> };
  workspace: { findMany: ReturnType<typeof vi.fn> };
  sourceControlOrg: { findMany: ReturnType<typeof vi.fn> };
  task: { findMany: ReturnType<typeof vi.fn> };
  feature: { findMany: ReturnType<typeof vi.fn> };
  milestone: { findMany: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
};

const USER_ID = "user-test-1";

function setupEmptyMocks() {
  mockedDb.sharedConversation.findMany.mockResolvedValue([]);
  mockedDb.$queryRaw
    .mockResolvedValueOnce([]) // plan chat rows
    .mockResolvedValueOnce([]); // task chat rows
  mockedDb.task.findMany.mockResolvedValue([]);
  mockedDb.feature.findMany.mockResolvedValue([]);
  mockedDb.milestone.findMany.mockResolvedValue([]);
  mockedDb.workspace.findMany.mockResolvedValue([]);
  mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);
}

function makeWorkspace(id = "ws-1", slug = "ws", name = "Workspace") {
  return { id, slug, name, sourceControlOrg: null };
}

function makeCreatedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Test Task",
    status: "TODO",
    workspaceId: "ws-1",
    createdAt: new Date("2024-06-10T10:00:00Z"),
    workspace: { slug: "ws", name: "Workspace", sourceControlOrg: null },
    ...overrides,
  };
}

function makeCreatedFeature(overrides: Record<string, unknown> = {}) {
  return {
    id: "feat-1",
    title: "Test Feature",
    status: "BACKLOG",
    workspaceId: "ws-1",
    createdAt: new Date("2024-06-10T11:00:00Z"),
    workspace: { slug: "ws", name: "Workspace", sourceControlOrg: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.milestone.findMany.mockResolvedValue([]);
});

// ── All-categories ────────────────────────────────────────────────────────

describe("getUserActivityFeed — all categories", () => {
  it("returns empty array when no activity found", async () => {
    setupEmptyMocks();
    const items = await getUserActivityFeed({ userId: USER_ID });
    expect(items).toEqual([]);
  });

  it("merges and sorts items from all sources by timestamp DESC", async () => {
    const oldest = new Date("2024-06-08T08:00:00Z");
    const middle = new Date("2024-06-09T10:00:00Z");
    const newest = new Date("2024-06-10T14:00:00Z");

    mockedDb.sharedConversation.findMany.mockResolvedValue([
      {
        id: "conv-1",
        title: "Dashboard chat",
        source: "dashboard",
        workspaceId: "ws-1",
        sourceControlOrgId: null,
        lastMessageAt: middle,
      },
    ]);
    mockedDb.$queryRaw
      .mockResolvedValueOnce([
        {
          featureId: "feat-1",
          title: "Plan feature",
          workspaceId: "ws-1",
          deleted: false,
          status: "BACKLOG",
          lastMessageAt: newest,
        },
      ])
      .mockResolvedValueOnce([
        {
          taskId: "task-1",
          title: "Task item",
          workspaceId: "ws-1",
          status: "TODO",
          lastMessageAt: oldest,
        },
      ]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const items = await getUserActivityFeed({ userId: USER_ID });

    expect(items).toHaveLength(3);
    expect(items[0].id).toBe("feat-1");
    expect(items[1].id).toBe("conv-1");
    expect(items[2].id).toBe("task-1");
  });

  it("deduplicates task created + task chat into one item with action='active'", async () => {
    const createdAt = new Date("2024-06-09T08:00:00Z");
    const chatAt = new Date("2024-06-10T12:00:00Z");

    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { taskId: "task-1", title: "My Task", workspaceId: "ws-1", status: "TODO", lastMessageAt: chatAt },
      ]);
    mockedDb.task.findMany.mockResolvedValue([makeCreatedTask({ createdAt })]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const items = await getUserActivityFeed({ userId: USER_ID });
    const taskItems = items.filter((i) => i.kind === "task");

    expect(taskItems).toHaveLength(1);
    expect(taskItems[0].action).toBe("active");
    expect(taskItems[0].timestamp).toBe(chatAt.toISOString());
  });
});

// ── Single-category filter ────────────────────────────────────────────────

describe("getUserActivityFeed — category filter", () => {
  it("category='task' skips conversation and feature queries", async () => {
    mockedDb.$queryRaw.mockResolvedValueOnce([]); // task chat only
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    await getUserActivityFeed({ userId: USER_ID, category: "task" });

    expect(mockedDb.sharedConversation.findMany).not.toHaveBeenCalled();
    expect(mockedDb.feature.findMany).not.toHaveBeenCalled();
    expect(mockedDb.milestone.findMany).not.toHaveBeenCalled();
  });

  it("category='plan' only returns plan items", async () => {
    mockedDb.$queryRaw.mockResolvedValueOnce([
      {
        featureId: "feat-plan",
        title: "Plan Feature",
        workspaceId: "ws-1",
        deleted: false,
        status: "BACKLOG",
        lastMessageAt: new Date("2024-06-10T10:00:00Z"),
      },
    ]);
    mockedDb.feature.findMany.mockResolvedValue([makeCreatedFeature()]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const items = await getUserActivityFeed({ userId: USER_ID, category: "plan" });

    expect(items.every((i) => i.category === "plan")).toBe(true);
    expect(mockedDb.sharedConversation.findMany).not.toHaveBeenCalled();
    expect(mockedDb.task.findMany).not.toHaveBeenCalled();
  });

  it("category='chat' only returns conversation items", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([
      {
        id: "conv-1",
        title: "Dashboard",
        source: "dashboard",
        workspaceId: "ws-1",
        sourceControlOrgId: null,
        lastMessageAt: new Date("2024-06-10T10:00:00Z"),
      },
    ]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const items = await getUserActivityFeed({ userId: USER_ID, category: "chat" });

    expect(items.every((i) => i.category === "chat")).toBe(true);
    expect(items).toHaveLength(1);
    expect(mockedDb.task.findMany).not.toHaveBeenCalled();
    expect(mockedDb.feature.findMany).not.toHaveBeenCalled();
  });

  it("category='milestone' only returns milestone items", async () => {
    mockedDb.milestone.findMany.mockResolvedValue([
      {
        id: "ms-1",
        name: "Launch",
        assigneeId: USER_ID,
        createdById: null,
        updatedAt: new Date("2024-06-10T10:00:00Z"),
        initiative: { id: "init-1", org: { githubLogin: "my-org" } },
      },
    ]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const items = await getUserActivityFeed({ userId: USER_ID, category: "milestone" });

    expect(items.every((i) => i.category === "milestone")).toBe(true);
    expect(items).toHaveLength(1);
    expect(mockedDb.task.findMany).not.toHaveBeenCalled();
    expect(mockedDb.feature.findMany).not.toHaveBeenCalled();
    expect(mockedDb.$queryRaw).not.toHaveBeenCalled();
  });
});

// ── q search ─────────────────────────────────────────────────────────────

describe("getUserActivityFeed — q search", () => {
  it("passes q as contains filter on task.findMany", async () => {
    setupEmptyMocks();
    await getUserActivityFeed({ userId: USER_ID, q: "my task" });

    const taskCall = mockedDb.task.findMany.mock.calls[0][0];
    expect(taskCall.where.title).toMatchObject({
      contains: "my task",
      mode: "insensitive",
    });
  });

  it("passes q as contains filter on feature.findMany", async () => {
    setupEmptyMocks();
    await getUserActivityFeed({ userId: USER_ID, q: "my feature" });

    const featCall = mockedDb.feature.findMany.mock.calls[0][0];
    expect(featCall.where.title).toMatchObject({
      contains: "my feature",
      mode: "insensitive",
    });
  });

  it("passes q as contains filter on sharedConversation.findMany", async () => {
    setupEmptyMocks();
    await getUserActivityFeed({ userId: USER_ID, q: "hello" });

    const convCall = mockedDb.sharedConversation.findMany.mock.calls[0][0];
    expect(convCall.where.title).toMatchObject({
      contains: "hello",
      mode: "insensitive",
    });
  });

  it("does not add title filter when q is empty string", async () => {
    setupEmptyMocks();
    await getUserActivityFeed({ userId: USER_ID, q: "" });

    const taskCall = mockedDb.task.findMany.mock.calls[0][0];
    expect(taskCall.where.title).toBeUndefined();
  });

  it("does not add title filter when q is whitespace only", async () => {
    setupEmptyMocks();
    await getUserActivityFeed({ userId: USER_ID, q: "   " });

    const taskCall = mockedDb.task.findMany.mock.calls[0][0];
    expect(taskCall.where.title).toBeUndefined();
  });
});

// ── limit clamping ────────────────────────────────────────────────────────

describe("getUserActivityFeed — limit clamping", () => {
  it("returns at most `limit` items", async () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      status: "TODO",
      workspaceId: "ws-1",
      createdAt: new Date(Date.now() - i * 1000),
      workspace: { slug: "ws", name: "Workspace", sourceControlOrg: null },
    }));

    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue(tasks);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const items = await getUserActivityFeed({ userId: USER_ID, limit: 3 });

    expect(items).toHaveLength(3);
  });

  it("defaults to 20 when limit is omitted", async () => {
    const tasks = Array.from({ length: 25 }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      status: "TODO",
      workspaceId: "ws-1",
      createdAt: new Date(Date.now() - i * 1000),
      workspace: { slug: "ws", name: "Workspace", sourceControlOrg: null },
    }));

    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue(tasks);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const items = await getUserActivityFeed({ userId: USER_ID });

    expect(items).toHaveLength(20);
  });

  it("returns 200 status equivalent — does not throw when queries partially fail", async () => {
    mockedDb.sharedConversation.findMany.mockRejectedValueOnce(new Error("DB down"));
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([makeCreatedTask()]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const items = await getUserActivityFeed({ userId: USER_ID });
    // Should still return task items even though conversations query failed
    expect(items.some((i) => i.kind === "task")).toBe(true);
  });
});

// ── completed field ───────────────────────────────────────────────────────

describe("getUserActivityFeed — completed field", () => {
  it("task with status DONE → completed: true", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([makeCreatedTask({ status: "DONE" })]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const items = await getUserActivityFeed({ userId: USER_ID });
    const task = items.find((i) => i.kind === "task");
    expect(task?.completed).toBe(true);
  });

  it("task with status TODO → completed: false", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([makeCreatedTask({ status: "TODO" })]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const items = await getUserActivityFeed({ userId: USER_ID });
    const task = items.find((i) => i.kind === "task");
    expect(task?.completed).toBe(false);
  });

  it("feature with status COMPLETED → completed: true", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([makeCreatedFeature({ status: "COMPLETED" })]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const items = await getUserActivityFeed({ userId: USER_ID });
    const plan = items.find((i) => i.kind === "plan");
    expect(plan?.completed).toBe(true);
  });
});
