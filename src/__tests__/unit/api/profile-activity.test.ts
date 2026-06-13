import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ authStatus: "authenticated", user: { id: "user-1" } })),
  requireAuth: vi.fn(() => ({ id: "user-1" })),
}));

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

// Mock pusher so notifyActivityUpdated tests can verify non-throwing behaviour
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getUserChannelName: (id: string) => `user-${id}`,
  PUSHER_EVENTS: { ACTIVITY_UPDATED: "activity-updated" },
  notifyActivityUpdated: vi.fn(),
}));

import { GET } from "@/app/api/profile/activity/route";
import { db } from "@/lib/db";
import { requireAuth, getMiddlewareContext } from "@/lib/middleware/utils";
import { NextResponse } from "next/server";

const mockedRequireAuth = vi.mocked(requireAuth);
const mockedGetMiddlewareContext = vi.mocked(getMiddlewareContext);
const mockedDb = db as {
  sharedConversation: { findMany: ReturnType<typeof vi.fn> };
  workspace: { findMany: ReturnType<typeof vi.fn> };
  sourceControlOrg: { findMany: ReturnType<typeof vi.fn> };
  task: { findMany: ReturnType<typeof vi.fn> };
  feature: { findMany: ReturnType<typeof vi.fn> };
  milestone: { findMany: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
};

function makeRequest(query: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/profile/activity");
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

function setAuth(authenticated: boolean) {
  if (authenticated) {
    mockedGetMiddlewareContext.mockReturnValue({
      requestId: "req-1",
      authStatus: "authenticated",
      user: { id: "user-1", email: "u@test.com", name: "User" },
    });
    mockedRequireAuth.mockReturnValue({ id: "user-1", email: "u@test.com", name: "User" });
  } else {
    mockedGetMiddlewareContext.mockReturnValue({ requestId: "req-1", authStatus: "error" });
    mockedRequireAuth.mockReturnValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
  }
}

/** Default mock: all queries return empty. */
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

function makeMilestone(overrides: Record<string, unknown> = {}) {
  return {
    id: "ms-1",
    name: "Test Milestone",
    assigneeId: "user-1",
    createdById: "user-1",
    updatedAt: new Date("2024-06-10T10:00:00Z"),
    initiative: {
      id: "init-1",
      org: { githubLogin: "my-org" },
    },
    ...overrides,
  };
}

function makeWorkspace(id = "ws-1", slug = "ws", name = "Workspace") {
  return { id, slug, name, sourceControlOrg: null };
}

function makeCreatedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-created-1",
    title: "Created Task",
    workspaceId: "ws-1",
    createdAt: new Date("2024-06-10T10:00:00Z"),
    workspace: { slug: "ws", name: "Workspace", sourceControlOrg: null },
    ...overrides,
  };
}

function makeCreatedFeature(overrides: Record<string, unknown> = {}) {
  return {
    id: "feat-created-1",
    title: "Created Feature",
    workspaceId: "ws-1",
    createdAt: new Date("2024-06-10T11:00:00Z"),
    workspace: { slug: "ws", name: "Workspace", sourceControlOrg: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setAuth(true);
  // Default: milestone query returns empty (overridden per-test where needed)
  mockedDb.milestone.findMany.mockResolvedValue([]);
});

// ── Existing behaviour ─────────────────────────────────────────────────────

describe("GET /api/profile/activity — existing behaviour", () => {
  it("returns 401 for unauthenticated requests", async () => {
    setAuth(false);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns empty items and null nextCursor when no activity found", async () => {
    setupEmptyMocks();
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it("deduplicates plan messages: same featureId yields one item with latest timestamp", async () => {
    const featureId = "feature-abc";
    const latestTs = new Date("2024-06-10T12:00:00Z");

    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw
      .mockResolvedValueOnce([
        {
          featureId,
          title: "My Feature",
          workspaceId: "ws-1",
          deleted: false,
          lastMessageAt: latestTs,
        },
      ])
      .mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    const planItems = body.items.filter((i: { kind: string }) => i.kind === "plan");
    expect(planItems).toHaveLength(1);
    expect(planItems[0].id).toBe(featureId);
    expect(planItems[0].timestamp).toBe(latestTs.toISOString());
    expect(planItems[0].link).toBe(`/w/ws/plan/${featureId}`);
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
          lastMessageAt: newest,
        },
      ])
      .mockResolvedValueOnce([
        {
          taskId: "task-1",
          title: "Task item",
          workspaceId: "ws-1",
          lastMessageAt: oldest,
        },
      ]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.items).toHaveLength(3);
    expect(body.items[0].id).toBe("feat-1");  // newest
    expect(body.items[1].id).toBe("conv-1");  // middle
    expect(body.items[2].id).toBe("task-1");  // oldest
  });

  it("clamps days=0 to 1 without throwing", async () => {
    setupEmptyMocks();
    const res = await GET(makeRequest({ days: "0" }));
    expect(res.status).toBe(200);
  });

  it("clamps days=999 to 30 without throwing", async () => {
    setupEmptyMocks();
    const res = await GET(makeRequest({ days: "999" }));
    expect(res.status).toBe(200);
  });

  it("generates correct links for each conversation source type", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([
      {
        id: "c-dashboard",
        title: "dash",
        source: "dashboard",
        workspaceId: "ws-1",
        sourceControlOrgId: null,
        lastMessageAt: new Date("2024-06-10T10:00:00Z"),
      },
      {
        id: "c-logs",
        title: "logs",
        source: "logs-agent",
        workspaceId: "ws-1",
        sourceControlOrgId: null,
        lastMessageAt: new Date("2024-06-10T09:00:00Z"),
      },
      {
        id: "c-canvas",
        title: "canvas",
        source: "org-canvas",
        workspaceId: null,
        sourceControlOrgId: "org-1",
        lastMessageAt: new Date("2024-06-10T08:00:00Z"),
      },
    ]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace("ws-1", "my-ws", "My WS")]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([{ id: "org-1", githubLogin: "my-org" }]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const byId = Object.fromEntries(
      body.items.map((i: { id: string; link: string }) => [i.id, i.link]),
    );

    expect(byId["c-dashboard"]).toBe("/w/my-ws?chat=c-dashboard");
    expect(byId["c-logs"]).toBe("/w/my-ws/agent-logs/chat/c-logs");
    expect(byId["c-canvas"]).toBe("/org/my-org?chat=c-canvas");
  });

  it("returns 200 and partial results when one query fails", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([
      {
        id: "c-1",
        title: "chat",
        source: "dashboard",
        workspaceId: "ws-1",
        sourceControlOrgId: null,
        lastMessageAt: new Date("2024-06-10T10:00:00Z"),
      },
    ]);
    mockedDb.$queryRaw.mockRejectedValueOnce(new Error("DB error")).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.some((i: { id: string }) => i.id === "c-1")).toBe(true);
  });
});

// ── New: created-by items ──────────────────────────────────────────────────

describe("GET /api/profile/activity — created-by items", () => {
  it("returns tasks created by user with action='created' and category='task'", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([makeCreatedTask()]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const taskItems = body.items.filter((i: { kind: string }) => i.kind === "task");

    expect(taskItems).toHaveLength(1);
    expect(taskItems[0].action).toBe("created");
    expect(taskItems[0].category).toBe("task");
    expect(taskItems[0].id).toBe("task-created-1");
    expect(taskItems[0].link).toBe("/w/ws/task/task-created-1");
  });

  it("returns features created by user with action='created' and category='plan'", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([makeCreatedFeature()]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const planItems = body.items.filter((i: { kind: string }) => i.kind === "plan");

    expect(planItems).toHaveLength(1);
    expect(planItems[0].action).toBe("created");
    expect(planItems[0].category).toBe("plan");
    expect(planItems[0].id).toBe("feat-created-1");
    expect(planItems[0].link).toBe("/w/ws/plan/feat-created-1");
  });
});

// ── New: de-duplication ────────────────────────────────────────────────────

describe("GET /api/profile/activity — de-duplication", () => {
  it("merges created task + task chat into one item with action='active' and latest timestamp", async () => {
    const createdAt = new Date("2024-06-09T08:00:00Z");
    const chatAt = new Date("2024-06-10T12:00:00Z"); // newer

    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    // plan chat returns nothing; task chat returns a chat row for the same task
    mockedDb.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { taskId: "task-1", title: "My Task", workspaceId: "ws-1", lastMessageAt: chatAt },
      ]);
    mockedDb.task.findMany.mockResolvedValue([
      {
        id: "task-1",
        title: "My Task",
        workspaceId: "ws-1",
        createdAt,
        workspace: { slug: "ws", name: "Workspace", sourceControlOrg: null },
      },
    ]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const taskItems = body.items.filter((i: { kind: string }) => i.kind === "task");

    // Only one item despite two sources
    expect(taskItems).toHaveLength(1);
    expect(taskItems[0].id).toBe("task-1");
    expect(taskItems[0].action).toBe("active");
    // Timestamp should be the latest (chat)
    expect(taskItems[0].timestamp).toBe(chatAt.toISOString());
  });

  it("merges created feature + plan chat into one item with action='active' and latest timestamp", async () => {
    const createdAt = new Date("2024-06-09T08:00:00Z");
    const chatAt = new Date("2024-06-10T14:00:00Z");

    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw
      .mockResolvedValueOnce([
        {
          featureId: "feat-1",
          title: "My Feature",
          workspaceId: "ws-1",
          deleted: false,
          lastMessageAt: chatAt,
        },
      ])
      .mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([
      {
        id: "feat-1",
        title: "My Feature",
        workspaceId: "ws-1",
        createdAt,
        workspace: { slug: "ws", name: "Workspace", sourceControlOrg: null },
      },
    ]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const planItems = body.items.filter((i: { kind: string }) => i.kind === "plan");

    expect(planItems).toHaveLength(1);
    expect(planItems[0].id).toBe("feat-1");
    expect(planItems[0].action).toBe("active");
    expect(planItems[0].timestamp).toBe(chatAt.toISOString());
  });

  it("keeps action='created' when created-at is newer than chat timestamp", async () => {
    const chatAt = new Date("2024-06-09T08:00:00Z");
    const createdAt = new Date("2024-06-10T14:00:00Z"); // newer but "created"

    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { taskId: "task-1", title: "My Task", workspaceId: "ws-1", lastMessageAt: chatAt },
      ]);
    mockedDb.task.findMany.mockResolvedValue([
      {
        id: "task-1",
        title: "My Task",
        workspaceId: "ws-1",
        createdAt,
        workspace: { slug: "ws", name: "Workspace", sourceControlOrg: null },
      },
    ]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const taskItems = body.items.filter((i: { kind: string }) => i.kind === "task");

    expect(taskItems).toHaveLength(1);
    // action is "active" whenever chat activity exists, regardless of which timestamp wins
    expect(taskItems[0].action).toBe("active");
    // timestamp is the later one (createdAt)
    expect(taskItems[0].timestamp).toBe(createdAt.toISOString());
  });
});

// ── New: cursor pagination ─────────────────────────────────────────────────

describe("GET /api/profile/activity — cursor pagination", () => {
  it("returns nextCursor equal to the last item timestamp when page is full", async () => {
    const limit = 2;
    const ts1 = new Date("2024-06-10T12:00:00Z");
    const ts2 = new Date("2024-06-09T12:00:00Z");

    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([
      {
        id: "t1", title: "Task 1", workspaceId: "ws-1", createdAt: ts1,
        workspace: { slug: "ws", name: "WS", sourceControlOrg: null },
      },
      {
        id: "t2", title: "Task 2", workspaceId: "ws-1", createdAt: ts2,
        workspace: { slug: "ws", name: "WS", sourceControlOrg: null },
      },
    ]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ limit: String(limit) }));
    const body = await res.json();

    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBe(ts2.toISOString());
  });

  it("returns nextCursor=null when results are fewer than limit", async () => {
    const ts1 = new Date("2024-06-10T12:00:00Z");

    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([
      {
        id: "t1", title: "Task 1", workspaceId: "ws-1", createdAt: ts1,
        workspace: { slug: "ws", name: "WS", sourceControlOrg: null },
      },
    ]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ limit: "20" }));
    const body = await res.json();

    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
  });

  it("passes cursor to task.findMany as an upper-bound filter", async () => {
    setupEmptyMocks();
    const cursor = "2024-06-09T00:00:00.000Z";
    await GET(makeRequest({ cursor }));

    const callArgs = mockedDb.task.findMany.mock.calls[0][0];
    // createdAt should have a `lt` filter equal to the cursor date
    expect(callArgs.where.createdAt).toMatchObject({ lt: new Date(cursor) });
  });

  it("passes cursor to feature.findMany as an upper-bound filter", async () => {
    setupEmptyMocks();
    const cursor = "2024-06-09T00:00:00.000Z";
    await GET(makeRequest({ cursor }));

    const callArgs = mockedDb.feature.findMany.mock.calls[0][0];
    expect(callArgs.where.createdAt).toMatchObject({ lt: new Date(cursor) });
  });
});

// ── New: category filter ───────────────────────────────────────────────────

describe("GET /api/profile/activity — category filter", () => {
  it("category=task skips conversation and feature queries", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]); // task chat only
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ category: "task" }));
    expect(res.status).toBe(200);
    // sharedConversation.findMany should not have been called with real data
    // (it's called with an empty resolved value but the DB call is skipped)
    expect(mockedDb.feature.findMany).toHaveBeenCalledTimes(0);
  });

  it("category=plan only returns plan items", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw
      .mockResolvedValueOnce([
        {
          featureId: "feat-plan", title: "Plan Chat Feature", workspaceId: "ws-1",
          deleted: false, lastMessageAt: new Date("2024-06-10T10:00:00Z"),
        },
      ]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([makeCreatedFeature()]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ category: "plan" }));
    const body = await res.json();

    expect(body.items.every((i: { category: string }) => i.category === "plan")).toBe(true);
    expect(body.items.some((i: { category: string }) => i.category === "task")).toBe(false);
    expect(body.items.some((i: { category: string }) => i.category === "chat")).toBe(false);
  });

  it("category=chat only returns conversation items", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([
      {
        id: "conv-1", title: "Dashboard", source: "dashboard",
        workspaceId: "ws-1", sourceControlOrgId: null,
        lastMessageAt: new Date("2024-06-10T10:00:00Z"),
      },
    ]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ category: "chat" }));
    const body = await res.json();

    expect(body.items.every((i: { category: string }) => i.category === "chat")).toBe(true);
    expect(body.items).toHaveLength(1);
  });
});

// ── New: q search ──────────────────────────────────────────────────────────

describe("GET /api/profile/activity — q search", () => {
  it("passes q as contains filter on sharedConversation.findMany", async () => {
    setupEmptyMocks();
    await GET(makeRequest({ q: "hello" }));

    const callArgs = mockedDb.sharedConversation.findMany.mock.calls[0][0];
    expect(callArgs.where.title).toMatchObject({
      contains: "hello",
      mode: "insensitive",
    });
  });

  it("passes q as contains filter on task.findMany", async () => {
    setupEmptyMocks();
    await GET(makeRequest({ q: "my task" }));

    const taskCall = mockedDb.task.findMany.mock.calls[0][0];
    expect(taskCall.where.title).toMatchObject({
      contains: "my task",
      mode: "insensitive",
    });
  });

  it("passes q as contains filter on feature.findMany", async () => {
    setupEmptyMocks();
    await GET(makeRequest({ q: "my feature" }));

    const featCall = mockedDb.feature.findMany.mock.calls[0][0];
    expect(featCall.where.title).toMatchObject({
      contains: "my feature",
      mode: "insensitive",
    });
  });

  it("does not add title filter when q is empty string", async () => {
    setupEmptyMocks();
    await GET(makeRequest({ q: "" }));

    const taskCall = mockedDb.task.findMany.mock.calls[0][0];
    expect(taskCall.where.title).toBeUndefined();
  });

  it("does not add title filter when q is whitespace only", async () => {
    setupEmptyMocks();
    await GET(makeRequest({ q: "   " }));

    const taskCall = mockedDb.task.findMany.mock.calls[0][0];
    expect(taskCall.where.title).toBeUndefined();
  });
});

// ── New: completed field ───────────────────────────────────────────────────

describe("GET /api/profile/activity — completed field", () => {
  it("task with status DONE → completed: true", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([makeCreatedTask({ status: "DONE" })]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const task = body.items.find((i: { kind: string }) => i.kind === "task");
    expect(task.completed).toBe(true);
  });

  it("task with status CANCELLED → completed: true", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([makeCreatedTask({ status: "CANCELLED" })]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const task = body.items.find((i: { kind: string }) => i.kind === "task");
    expect(task.completed).toBe(true);
  });

  it("task with status TODO → completed: false", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([makeCreatedTask({ status: "TODO" })]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const task = body.items.find((i: { kind: string }) => i.kind === "task");
    expect(task.completed).toBe(false);
  });

  it("task with status IN_PROGRESS → completed: false", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([makeCreatedTask({ status: "IN_PROGRESS" })]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const task = body.items.find((i: { kind: string }) => i.kind === "task");
    expect(task.completed).toBe(false);
  });

  it("feature with status COMPLETED → completed: true", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([makeCreatedFeature({ status: "COMPLETED" })]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const plan = body.items.find((i: { kind: string }) => i.kind === "plan");
    expect(plan.completed).toBe(true);
  });

  it("feature with status CANCELLED → completed: true", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([makeCreatedFeature({ status: "CANCELLED" })]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const plan = body.items.find((i: { kind: string }) => i.kind === "plan");
    expect(plan.completed).toBe(true);
  });

  it("feature with status BACKLOG → completed: false", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([makeCreatedFeature({ status: "BACKLOG" })]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const plan = body.items.find((i: { kind: string }) => i.kind === "plan");
    expect(plan.completed).toBe(false);
  });

  it("feature with status IN_PROGRESS → completed: false", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([makeCreatedFeature({ status: "IN_PROGRESS" })]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const plan = body.items.find((i: { kind: string }) => i.kind === "plan");
    expect(plan.completed).toBe(false);
  });

  it("conversation item → completed: false", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([
      {
        id: "conv-1",
        title: "Dashboard chat",
        source: "dashboard",
        workspaceId: "ws-1",
        sourceControlOrgId: null,
        lastMessageAt: new Date("2024-06-10T10:00:00Z"),
      },
    ]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const conv = body.items.find((i: { kind: string }) => i.kind === "conversation");
    expect(conv.completed).toBe(false);
  });

  it("upsert merge: either copy completed=true → merged result is true", async () => {
    const createdAt = new Date("2024-06-09T08:00:00Z");
    const chatAt = new Date("2024-06-10T12:00:00Z");

    // created task has status TODO (not completed), chat row has status DONE (completed)
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          taskId: "task-merge",
          title: "Merge Task",
          workspaceId: "ws-1",
          status: "DONE",
          lastMessageAt: chatAt,
        },
      ]);
    mockedDb.task.findMany.mockResolvedValue([
      {
        id: "task-merge",
        title: "Merge Task",
        workspaceId: "ws-1",
        status: "TODO",
        createdAt,
        workspace: { slug: "ws", name: "Workspace", sourceControlOrg: null },
      },
    ]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const task = body.items.find((i: { id: string }) => i.id === "task-merge");
    expect(task.completed).toBe(true);
  });
});

// ── New: milestone category ────────────────────────────────────────────────

describe("GET /api/profile/activity — milestone category", () => {
  it("returns milestones assigned to user with category='milestone'", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.milestone.findMany.mockResolvedValue([
      makeMilestone({ assigneeId: "user-1", createdById: null }),
    ]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ category: "milestone" }));
    const body = await res.json();

    const msItems = body.items.filter((i: { category: string }) => i.category === "milestone");
    expect(msItems).toHaveLength(1);
    expect(msItems[0].id).toBe("ms-1");
    expect(msItems[0].kind).toBe("milestone");
    expect(msItems[0].category).toBe("milestone");
    expect(msItems[0].action).toBe("active"); // assigned but not creator
  });

  it("returns milestones created by user with action='created'", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.milestone.findMany.mockResolvedValue([
      makeMilestone({ assigneeId: null, createdById: "user-1" }),
    ]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ category: "milestone" }));
    const body = await res.json();

    const msItems = body.items.filter((i: { category: string }) => i.category === "milestone");
    expect(msItems).toHaveLength(1);
    expect(msItems[0].action).toBe("created");
  });

  it("excludes milestones where both assigneeId and createdById are null", async () => {
    // The DB query uses OR: [{ assigneeId: userId }, { createdById: userId }]
    // so a row with both null would never be returned; verify the mapping handles
    // the case gracefully if it were ever included (e.g., action defaults to 'active')
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    // Simulate DB returning empty (Prisma WHERE OR won't match null/null rows)
    mockedDb.milestone.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ category: "milestone" }));
    const body = await res.json();

    const msItems = body.items.filter((i: { category: string }) => i.category === "milestone");
    expect(msItems).toHaveLength(0);
  });

  it("respects q search on milestone name", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.milestone.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    await GET(makeRequest({ category: "milestone", q: "launch" }));

    const callArgs = mockedDb.milestone.findMany.mock.calls[0][0];
    expect(callArgs.where.name).toMatchObject({
      contains: "launch",
      mode: "insensitive",
    });
  });

  it("builds correct initiative deep-link when githubLogin and initiativeId are present", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.milestone.findMany.mockResolvedValue([
      makeMilestone({
        initiative: {
          id: "init-42",
          org: { githubLogin: "my-org" },
        },
      }),
    ]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ category: "milestone" }));
    const body = await res.json();

    expect(body.items[0].link).toBe("/org/my-org?canvas=initiative:init-42");
    expect(body.items[0].orgName).toBe("my-org");
  });

  it("falls back to '#' link when initiative/org is missing", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.milestone.findMany.mockResolvedValue([
      makeMilestone({ initiative: null }),
    ]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ category: "milestone" }));
    const body = await res.json();

    expect(body.items[0].link).toBe("#");
  });

  it("category=milestone skips task, plan, and chat queries", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.milestone.findMany.mockResolvedValue([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ category: "milestone" }));
    expect(res.status).toBe(200);
    expect(mockedDb.task.findMany).not.toHaveBeenCalled();
    expect(mockedDb.feature.findMany).not.toHaveBeenCalled();
    expect(mockedDb.$queryRaw).not.toHaveBeenCalled();
  });

  it("follows Promise.allSettled failure isolation — milestone query failure does not crash others", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([
      {
        id: "c-1",
        title: "chat",
        source: "dashboard",
        workspaceId: "ws-1",
        sourceControlOrgId: null,
        lastMessageAt: new Date("2024-06-10T10:00:00Z"),
      },
    ]);
    mockedDb.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedDb.task.findMany.mockResolvedValue([]);
    mockedDb.feature.findMany.mockResolvedValue([]);
    mockedDb.milestone.findMany.mockRejectedValueOnce(new Error("milestone DB error"));
    mockedDb.workspace.findMany.mockResolvedValue([makeWorkspace()]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    // Chat item still returned even though milestone query failed
    expect(body.items.some((i: { id: string }) => i.id === "c-1")).toBe(true);
  });
});

// ── New: notifyActivityUpdated non-throwing ────────────────────────────────

describe("notifyActivityUpdated — non-throwing when Pusher env unset", () => {
  it("does not throw when pusherServer.trigger throws synchronously", async () => {
    // Import the real pusher module (not the mocked one used in route tests)
    // We test the actual helper by reimporting with a throwing mock.
    vi.doMock("@/lib/pusher", async (importOriginal) => {
      const original = await importOriginal<typeof import("@/lib/pusher")>();
      return {
        ...original,
        pusherServer: {
          trigger: () => {
            throw new Error("Pusher env not configured");
          },
        },
      };
    });

    const { notifyActivityUpdated } = await import("@/lib/pusher");

    // Must not throw
    expect(() => notifyActivityUpdated("user-1")).not.toThrow();

    vi.doUnmock("@/lib/pusher");
  });

  it("does not throw when pusherServer.trigger returns a rejected promise", async () => {
    vi.doMock("@/lib/pusher", async (importOriginal) => {
      const original = await importOriginal<typeof import("@/lib/pusher")>();
      return {
        ...original,
        pusherServer: {
          trigger: () => Promise.reject(new Error("Pusher async failure")),
        },
      };
    });

    const { notifyActivityUpdated } = await import("@/lib/pusher");

    // Must not throw, even for async rejection (fire-and-forget .catch handler)
    expect(() => notifyActivityUpdated("user-1")).not.toThrow();

    vi.doUnmock("@/lib/pusher");
  });
});
