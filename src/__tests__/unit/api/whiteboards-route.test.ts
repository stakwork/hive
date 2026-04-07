import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/whiteboards/route";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
    whiteboard: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    feature: {
      findFirst: vi.fn(),
    },
  },
}));

function authedGetRequest(url: string, userId = "user1") {
  const headers = new Headers();
  headers.set("x-middleware-auth-status", "authenticated");
  headers.set("x-middleware-user-id", userId);
  headers.set("x-middleware-user-email", "test@example.com");
  headers.set("x-middleware-user-name", "Test User");
  return new NextRequest(url, { method: "GET", headers });
}

function authedPostRequest(url: string, body: object, userId = "user1") {
  const headers = new Headers();
  headers.set("x-middleware-auth-status", "authenticated");
  headers.set("x-middleware-user-id", userId);
  headers.set("x-middleware-user-email", "test@example.com");
  headers.set("x-middleware-user-name", "Test User");
  headers.set("Content-Type", "application/json");
  return new NextRequest(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const mockWorkspace = { id: "ws1", ownerId: "user1", members: [] };

const mockCreator = { id: "user1", name: "Alice", image: "https://example.com/alice.jpg" };

const mockWhiteboard = {
  id: "wb1",
  name: "My Board",
  featureId: null,
  feature: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: mockCreator,
};

const mockWhiteboardOtherCreator = {
  id: "wb2",
  name: "Other Board",
  featureId: null,
  feature: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: { id: "user2", name: "Bob", image: null },
};

describe("GET /api/whiteboards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.whiteboard.count as Mock).mockResolvedValue(0);
  });

  test("returns whiteboards with createdBy field", async () => {
    (db.whiteboard.findMany as Mock).mockResolvedValue([mockWhiteboard]);
    (db.whiteboard.count as Mock).mockResolvedValue(1);

    const req = authedGetRequest("http://localhost/api/whiteboards?workspaceId=ws1");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].createdBy).toEqual(mockCreator);
  });

  test("filters by createdById when param provided", async () => {
    (db.whiteboard.findMany as Mock).mockResolvedValue([mockWhiteboard]);
    (db.whiteboard.count as Mock).mockResolvedValue(1);

    const req = authedGetRequest(
      "http://localhost/api/whiteboards?workspaceId=ws1&createdById=user1"
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);

    // Verify db was called with the createdById filter
    expect(db.whiteboard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdById: "user1" }),
      })
    );
  });

  test("does not filter by createdById when param is ALL", async () => {
    (db.whiteboard.findMany as Mock).mockResolvedValue([
      mockWhiteboard,
      mockWhiteboardOtherCreator,
    ]);
    (db.whiteboard.count as Mock).mockResolvedValue(2);

    const req = authedGetRequest(
      "http://localhost/api/whiteboards?workspaceId=ws1&createdById=ALL"
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);

    // where should NOT have createdById key
    const callArg = (db.whiteboard.findMany as Mock).mock.calls[0][0];
    expect(callArg.where).not.toHaveProperty("createdById");
  });

  test("returns null createdBy for legacy whiteboards", async () => {
    const legacyBoard = { ...mockWhiteboard, createdBy: null };
    (db.whiteboard.findMany as Mock).mockResolvedValue([legacyBoard]);
    (db.whiteboard.count as Mock).mockResolvedValue(1);

    const req = authedGetRequest("http://localhost/api/whiteboards?workspaceId=ws1");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0].createdBy).toBeNull();
  });

  test("returns 400 when workspaceId missing", async () => {
    const req = authedGetRequest("http://localhost/api/whiteboards");
    const res = await GET(req);

    expect(res.status).toBe(400);
  });
});

describe("POST /api/whiteboards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
  });

  test("sets createdById to the authenticated user's ID", async () => {
    const createdBoard = {
      id: "wb-new",
      name: "New Board",
      workspaceId: "ws1",
      featureId: null,
      createdById: "user1",
      elements: [],
      appState: {},
      files: {},
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      feature: null,
    };
    (db.whiteboard.create as Mock).mockResolvedValue(createdBoard);

    const req = authedPostRequest(
      "http://localhost/api/whiteboards",
      { workspaceId: "ws1", name: "New Board" },
      "user1"
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);

    expect(db.whiteboard.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdById: "user1" }),
      })
    );
  });

  test("returns 400 when required fields are missing", async () => {
    const req = authedPostRequest(
      "http://localhost/api/whiteboards",
      { workspaceId: "ws1" }, // missing name
      "user1"
    );
    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});
