import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findMany: vi.fn() },
    workspaceMember: { findMany: vi.fn() },
  },
}));

const { db } = await import("@/lib/db");
const mockWorkspaceFindMany = db.workspace.findMany as Mock;
const mockMemberFindMany = db.workspaceMember.findMany as Mock;

const { GET } = await import("@/app/api/orgs/[githubLogin]/members/route");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAuthRequest(userId = "user-1"): NextRequest {
  const req = new NextRequest("http://localhost/api/orgs/test-org/members");
  req.headers.set(MIDDLEWARE_HEADERS.USER_ID, userId);
  req.headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, "test@example.com");
  req.headers.set(MIDDLEWARE_HEADERS.USER_NAME, "Test User");
  req.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  return req;
}

function makeUnauthRequest(): NextRequest {
  return new NextRequest("http://localhost/api/orgs/test-org/members");
}

const params = { params: Promise.resolve({ githubLogin: "test-org" }) };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/orgs/[githubLogin]/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated requests", async () => {
    const res = await GET(makeUnauthRequest(), params);
    expect(res.status).toBe(401);
  });

  it("returns empty array when user has no accessible workspaces", async () => {
    mockWorkspaceFindMany.mockResolvedValue([]);

    const res = await GET(makeAuthRequest(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(mockMemberFindMany).not.toHaveBeenCalled();
  });

  it("returns members grouped by userId with workspaceDescriptions", async () => {
    mockWorkspaceFindMany.mockResolvedValue([{ id: "ws-1" }, { id: "ws-2" }]);
    mockMemberFindMany.mockResolvedValue([
      {
        userId: "user-a",
        workspaceId: "ws-1",
        description: "Frontend wizard",
        workspace: { name: "Workspace One" },
        user: { id: "user-a", name: "Alice", image: null, githubAuth: { githubUsername: "alice" } },
      },
      {
        userId: "user-a",
        workspaceId: "ws-2",
        description: "Backend too",
        workspace: { name: "Workspace Two" },
        user: { id: "user-a", name: "Alice", image: null, githubAuth: { githubUsername: "alice" } },
      },
      {
        userId: "user-b",
        workspaceId: "ws-1",
        description: null,
        workspace: { name: "Workspace One" },
        user: { id: "user-b", name: "Bob", image: "https://img.example.com/bob.png", githubAuth: null },
      },
    ]);

    const res = await GET(makeAuthRequest(), params);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Two distinct users
    expect(data).toHaveLength(2);

    const alice = data.find((m: { id: string }) => m.id === "user-a");
    expect(alice).toBeDefined();
    expect(alice.name).toBe("Alice");
    expect(alice.githubUsername).toBe("alice");
    // Alice appears in both workspaces — both descriptions present
    expect(alice.workspaceDescriptions).toHaveLength(2);
    expect(alice.workspaceDescriptions).toEqual(
      expect.arrayContaining([
        { workspaceId: "ws-1", workspaceName: "Workspace One", description: "Frontend wizard" },
        { workspaceId: "ws-2", workspaceName: "Workspace Two", description: "Backend too" },
      ])
    );

    const bob = data.find((m: { id: string }) => m.id === "user-b");
    expect(bob).toBeDefined();
    expect(bob.githubUsername).toBeNull();
    expect(bob.workspaceDescriptions).toHaveLength(1);
    expect(bob.workspaceDescriptions[0]).toEqual({
      workspaceId: "ws-1",
      workspaceName: "Workspace One",
      description: null,
    });
  });

  it("deduplicates users — each userId appears exactly once in the response", async () => {
    mockWorkspaceFindMany.mockResolvedValue([{ id: "ws-1" }, { id: "ws-2" }, { id: "ws-3" }]);

    // Same user is a member of three workspaces
    const sharedUser = {
      id: "user-x",
      name: "Xavier",
      image: null,
      githubAuth: { githubUsername: "xavier" },
    };
    mockMemberFindMany.mockResolvedValue([
      { userId: "user-x", workspaceId: "ws-1", description: "desc-1", workspace: { name: "WS 1" }, user: sharedUser },
      { userId: "user-x", workspaceId: "ws-2", description: "desc-2", workspace: { name: "WS 2" }, user: sharedUser },
      { userId: "user-x", workspaceId: "ws-3", description: null, workspace: { name: "WS 3" }, user: sharedUser },
    ]);

    const res = await GET(makeAuthRequest(), params);
    const data = await res.json();

    // Exactly one entry for user-x
    expect(data.filter((m: { id: string }) => m.id === "user-x")).toHaveLength(1);
    // But all three workspaceDescriptions are present
    const xavier = data.find((m: { id: string }) => m.id === "user-x");
    expect(xavier.workspaceDescriptions).toHaveLength(3);
  });

  it("returns 500 on unexpected database error from member query", async () => {
    mockWorkspaceFindMany.mockResolvedValue([{ id: "ws-1" }]);
    mockMemberFindMany.mockRejectedValue(new Error("DB down"));

    const res = await GET(makeAuthRequest(), params);
    expect(res.status).toBe(500);
  });
});
