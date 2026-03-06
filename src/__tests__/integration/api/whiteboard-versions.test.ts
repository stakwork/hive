import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET, POST } from "@/app/api/whiteboards/[whiteboardId]/versions/route";
import { POST as RESTORE } from "@/app/api/whiteboards/[whiteboardId]/versions/[versionId]/restore/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";

// Helper to create a whiteboard directly
async function createTestWhiteboard(workspaceId: string) {
  return db.whiteboard.create({
    data: {
      name: "Test Whiteboard",
      workspaceId,
      elements: [],
      appState: { viewBackgroundColor: "#ffffff", gridSize: null },
      files: {},
    },
  });
}

// Helper to create a version directly
async function createTestVersion(whiteboardId: string, label: string) {
  return db.whiteboardVersion.create({
    data: {
      whiteboardId,
      elements: [{ id: "el1" }],
      appState: {},
      files: {},
      label,
    },
  });
}

describe("GET /api/whiteboards/[whiteboardId]/versions", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testWhiteboard: Awaited<ReturnType<typeof createTestWhiteboard>>;
  let otherUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });
    testWhiteboard = await createTestWhiteboard(testWorkspace.id);
    otherUser = await createTestUser();
  });



  afterEach(async () => {
    await db.whiteboardVersion.deleteMany({ where: { whiteboardId: testWhiteboard.id } });
    await db.whiteboard.deleteMany({ where: { id: testWhiteboard.id } });
    await db.workspace.deleteMany({ where: { id: testWorkspace.id } });
    await db.user.deleteMany({ where: { id: { in: [testUser.id, otherUser.id] } } });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const req = new Request(`http://localhost/api/whiteboards/${testWhiteboard.id}/versions`, { method: "GET" });
    const res = await GET(req as never, { params: Promise.resolve({ whiteboardId: testWhiteboard.id }) });
    await expectUnauthorized(res);
  });

  it("returns 403 for non-workspace members", async () => {
    const req = createAuthenticatedGetRequest(
      `http://localhost/api/whiteboards/${testWhiteboard.id}/versions`,
      otherUser
    );
    const res = await GET(req, { params: Promise.resolve({ whiteboardId: testWhiteboard.id }) });
    await expectForbidden(res);
  });

  it("returns 404 for unknown whiteboard", async () => {
    const req = createAuthenticatedGetRequest(
      `http://localhost/api/whiteboards/nonexistent/versions`,
      testUser
    );
    const res = await GET(req, { params: Promise.resolve({ whiteboardId: "nonexistent" }) });
    await expectNotFound(res);
  });

  it("returns empty array when no versions exist", async () => {
    const req = createAuthenticatedGetRequest(
      `http://localhost/api/whiteboards/${testWhiteboard.id}/versions`,
      testUser
    );
    const res = await GET(req, { params: Promise.resolve({ whiteboardId: testWhiteboard.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("returns versions ordered newest first", async () => {
    // Small delays ensure distinct createdAt timestamps for deterministic ordering
    await createTestVersion(testWhiteboard.id, "Version 1");
    await new Promise((r) => setTimeout(r, 10));
    await createTestVersion(testWhiteboard.id, "Version 2");
    await new Promise((r) => setTimeout(r, 10));
    await createTestVersion(testWhiteboard.id, "Version 3");
    await new Promise((r) => setTimeout(r, 10));

    const req = createAuthenticatedGetRequest(
      `http://localhost/api/whiteboards/${testWhiteboard.id}/versions`,
      testUser
    );
    const res = await GET(req, { params: Promise.resolve({ whiteboardId: testWhiteboard.id }) });
    const body = await res.json();

    expect(body.data).toHaveLength(3);
    expect(body.data[0].label).toBe("Version 3");
    expect(body.data[2].label).toBe("Version 1");
  });
});

describe("POST /api/whiteboards/[whiteboardId]/versions", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testWhiteboard: Awaited<ReturnType<typeof createTestWhiteboard>>;

  beforeEach(async () => {
    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });
    testWhiteboard = await createTestWhiteboard(testWorkspace.id);
  });

  afterEach(async () => {
    await db.whiteboardVersion.deleteMany({ where: { whiteboardId: testWhiteboard.id } });
    await db.whiteboard.deleteMany({ where: { id: testWhiteboard.id } });
    await db.workspace.deleteMany({ where: { id: testWorkspace.id } });
    await db.user.deleteMany({ where: { id: testUser.id } });
  });

  it("creates a new version and returns 201", async () => {
    const req = createAuthenticatedPostRequest(
      `http://localhost/api/whiteboards/${testWhiteboard.id}/versions`,
      testUser,
      { elements: [{ id: "el1" }], appState: {}, files: {}, label: "Snapshot 1" }
    );
    const res = await POST(req, { params: Promise.resolve({ whiteboardId: testWhiteboard.id }) });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.label).toBe("Snapshot 1");
    expect(body.data.whiteboardId).toBe(testWhiteboard.id);
  });

  it("prunes to at most 3 versions when a 4th is created", async () => {
    // Seed 3 versions with distinct timestamps
    const v1 = await createTestVersion(testWhiteboard.id, "Oldest");
    await new Promise((r) => setTimeout(r, 10));
    await createTestVersion(testWhiteboard.id, "Middle");
    await new Promise((r) => setTimeout(r, 10));
    await createTestVersion(testWhiteboard.id, "Recent");
    await new Promise((r) => setTimeout(r, 10));

    // Create a 4th via the API
    const req = createAuthenticatedPostRequest(
      `http://localhost/api/whiteboards/${testWhiteboard.id}/versions`,
      testUser,
      { elements: [], appState: {}, files: {}, label: "Newest" }
    );
    const res = await POST(req, { params: Promise.resolve({ whiteboardId: testWhiteboard.id }) });
    expect(res.status).toBe(201);

    const remaining = await db.whiteboardVersion.findMany({
      where: { whiteboardId: testWhiteboard.id },
      orderBy: { createdAt: "asc" },
    });

    expect(remaining).toHaveLength(3);
    // The oldest (v1) should have been deleted
    expect(remaining.find((v) => v.id === v1.id)).toBeUndefined();
    expect(remaining[remaining.length - 1].label).toBe("Newest");
  });
});

describe("POST /api/whiteboards/[whiteboardId]/versions/[versionId]/restore", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testWhiteboard: Awaited<ReturnType<typeof createTestWhiteboard>>;
  let targetVersion: Awaited<ReturnType<typeof createTestVersion>>;

  beforeEach(async () => {
    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });
    testWhiteboard = await createTestWhiteboard(testWorkspace.id);
    targetVersion = await createTestVersion(testWhiteboard.id, "Restore point");
  });

  afterEach(async () => {
    await db.whiteboardVersion.deleteMany({ where: { whiteboardId: testWhiteboard.id } });
    await db.whiteboard.deleteMany({ where: { id: testWhiteboard.id } });
    await db.workspace.deleteMany({ where: { id: testWorkspace.id } });
    await db.user.deleteMany({ where: { id: testUser.id } });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const req = new Request(
      `http://localhost/api/whiteboards/${testWhiteboard.id}/versions/${targetVersion.id}/restore`,
      { method: "POST" }
    );
    const res = await RESTORE(req as never, {
      params: Promise.resolve({ whiteboardId: testWhiteboard.id, versionId: targetVersion.id }),
    });
    await expectUnauthorized(res);
  });

  it("returns 404 for unknown version", async () => {
    const req = createAuthenticatedPostRequest(
      `http://localhost/api/whiteboards/${testWhiteboard.id}/versions/nonexistent/restore`,
      testUser,
      {}
    );
    const res = await RESTORE(req, {
      params: Promise.resolve({ whiteboardId: testWhiteboard.id, versionId: "nonexistent" }),
    });
    await expectNotFound(res);
  });

  it("creates a pre-restore snapshot of the current state", async () => {
    const req = createAuthenticatedPostRequest(
      `http://localhost/api/whiteboards/${testWhiteboard.id}/versions/${targetVersion.id}/restore`,
      testUser,
      {}
    );
    await RESTORE(req, {
      params: Promise.resolve({ whiteboardId: testWhiteboard.id, versionId: targetVersion.id }),
    });

    const versions = await db.whiteboardVersion.findMany({
      where: { whiteboardId: testWhiteboard.id },
      orderBy: { createdAt: "desc" },
    });

    const preRestoreSnapshot = versions.find((v) => v.label.startsWith("Before restore"));
    expect(preRestoreSnapshot).toBeDefined();
  });

  it("applies the target version's content to the whiteboard and increments version", async () => {
    const beforeVersion = testWhiteboard.version;

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/whiteboards/${testWhiteboard.id}/versions/${targetVersion.id}/restore`,
      testUser,
      {}
    );
    const res = await RESTORE(req, {
      params: Promise.resolve({ whiteboardId: testWhiteboard.id, versionId: targetVersion.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.version).toBe(beforeVersion + 1);

    // Confirm DB was updated
    const updated = await db.whiteboard.findUnique({ where: { id: testWhiteboard.id } });
    expect(updated?.version).toBe(beforeVersion + 1);
  });
});
