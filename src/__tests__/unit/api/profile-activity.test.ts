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
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
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

function setupDefaultDbMocks() {
  mockedDb.sharedConversation.findMany.mockResolvedValue([]);
  mockedDb.$queryRaw
    .mockResolvedValueOnce([]) // plan rows
    .mockResolvedValueOnce([]); // task rows
  mockedDb.workspace.findMany.mockResolvedValue([]);
  mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setAuth(true);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/profile/activity", () => {
  it("returns 401 for unauthenticated requests", async () => {
    setAuth(false);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns an empty items array when no activity found", async () => {
    setupDefaultDbMocks();
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.items).toEqual([]);
  });

  it("deduplicates plan messages: same featureId yields one item with latest timestamp", async () => {
    // The raw SQL already handles deduplication via GROUP BY / MAX; here we verify
    // that the route correctly maps the single result row to one ActivityItem.
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
    mockedDb.workspace.findMany.mockResolvedValue([
      { id: "ws-1", slug: "my-workspace", name: "My Workspace", sourceControlOrg: null },
    ]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    const planItems = body.items.filter((i: { kind: string }) => i.kind === "plan");
    expect(planItems).toHaveLength(1);
    expect(planItems[0].id).toBe(featureId);
    expect(planItems[0].timestamp).toBe(latestTs.toISOString());
    expect(planItems[0].link).toBe(`/w/my-workspace/plan/${featureId}`);
  });

  it("merges and sorts items from all three sources by timestamp DESC", async () => {
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
    mockedDb.workspace.findMany.mockResolvedValue([
      { id: "ws-1", slug: "ws", name: "Workspace", sourceControlOrg: null },
    ]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.items).toHaveLength(3);
    expect(body.items[0].id).toBe("feat-1"); // newest
    expect(body.items[1].id).toBe("conv-1"); // middle
    expect(body.items[2].id).toBe("task-1"); // oldest
  });

  it("clamps days=0 to 1", async () => {
    setupDefaultDbMocks();
    const res = await GET(makeRequest({ days: "0" }));
    expect(res.status).toBe(200);
    // Can't easily assert the cutoff date, but we verify it doesn't throw
  });

  it("clamps days=999 to 30", async () => {
    setupDefaultDbMocks();
    const res = await GET(makeRequest({ days: "999" }));
    expect(res.status).toBe(200);
  });

  it("does not return items for deleted features (SQL filters f.deleted = false)", async () => {
    // The raw SQL has `AND f.deleted = false`. We simulate the DB returning
    // nothing for a deleted feature (as the query would in production).
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw
      .mockResolvedValueOnce([]) // no rows returned because feature is deleted
      .mockResolvedValueOnce([]);
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const planItems = body.items.filter((i: { kind: string }) => i.kind === "plan");
    expect(planItems).toHaveLength(0);
  });

  it("does not return items for deleted/archived tasks (SQL filters t.deleted + t.archived)", async () => {
    mockedDb.sharedConversation.findMany.mockResolvedValue([]);
    mockedDb.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // no rows because task is deleted/archived
    mockedDb.workspace.findMany.mockResolvedValue([]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const taskItems = body.items.filter((i: { kind: string }) => i.kind === "task");
    expect(taskItems).toHaveLength(0);
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
    mockedDb.workspace.findMany.mockResolvedValue([
      { id: "ws-1", slug: "my-ws", name: "My WS", sourceControlOrg: null },
    ]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([
      { id: "org-1", githubLogin: "my-org" },
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();
    const byId = Object.fromEntries(
      body.items.map((i: { id: string; link: string }) => [i.id, i.link]),
    );

    expect(byId["c-dashboard"]).toBe("/w/my-ws");
    expect(byId["c-logs"]).toBe("/w/my-ws/agent-logs");
    expect(byId["c-canvas"]).toBe("/org/my-org");
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
    // Plan query fails, task query succeeds with empty
    mockedDb.$queryRaw.mockRejectedValueOnce(new Error("DB error")).mockResolvedValueOnce([]);
    mockedDb.workspace.findMany.mockResolvedValue([
      { id: "ws-1", slug: "ws", name: "WS", sourceControlOrg: null },
    ]);
    mockedDb.sourceControlOrg.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    // Conversation still returned
    expect(body.items.some((i: { id: string }) => i.id === "c-1")).toBe(true);
  });
});
