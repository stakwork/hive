import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PATCH } from "@/app/api/whiteboards/[whiteboardId]/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedPatchRequest,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";

/**
 * Integration tests for PATCH /api/whiteboards/[whiteboardId]
 *
 * Verifies:
 * 1. Files are correctly merged and persisted across sequential saves.
 * 2. Version conflict (409 stale) returns currentVersion for client retry.
 * 3. Stale saves with expectedVersion < DB version are rejected with 409.
 */

async function createTestWhiteboard(
  workspaceId: string,
  files: Record<string, unknown> = {},
  elements: unknown[] = [],
  version = 0
) {
  return db.whiteboard.create({
    data: {
      name: "Test Whiteboard",
      workspaceId,
      elements,
      appState: { viewBackgroundColor: "#ffffff", gridSize: null },
      files,
      version,
    },
  });
}

describe("PATCH /api/whiteboards/[whiteboardId] — files merging across sequential saves", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testWhiteboard: Awaited<ReturnType<typeof createTestWhiteboard>>;

  beforeEach(async () => {
    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });
    testWhiteboard = await createTestWhiteboard(testWorkspace.id);
  });

  afterEach(async () => {
    await db.whiteboard.deleteMany({ where: { id: testWhiteboard.id } });
    await db.workspace.deleteMany({ where: { id: testWorkspace.id } });
    await db.user.deleteMany({ where: { id: testUser.id } });
  });

  it("persists files from first save and keeps them after second save adds more files", async () => {
    const whiteboardId = testWhiteboard.id;
    const url = `http://localhost/api/whiteboards/${whiteboardId}`;

    // First save: adds file-1
    const firstReq = createAuthenticatedPatchRequest(
      url,
      {
        elements: [{ id: "el1", type: "rectangle", x: 0, y: 0, width: 100, height: 100 }],
        appState: { viewBackgroundColor: "#ffffff", gridSize: null },
        files: {
          "file-1": { id: "file-1", mimeType: "image/png", s3Key: "uploads/file-1.png" },
        },
        expectedVersion: 0,
        broadcast: false,
        senderId: "sender-1",
      },
      testUser
    );

    const firstRes = await PATCH(firstReq, { params: Promise.resolve({ whiteboardId }) });
    expect(firstRes.status).toBe(200);
    const firstResult = await firstRes.json();
    expect(firstResult.success).toBe(true);
    expect(firstResult.data.version).toBe(1);

    // Verify DB state: file-1 present
    const afterFirst = await db.whiteboard.findUnique({ where: { id: whiteboardId } });
    expect(afterFirst?.files).toMatchObject({
      "file-1": { id: "file-1", mimeType: "image/png", s3Key: "uploads/file-1.png" },
    });

    // Second save: adds file-2, should NOT drop file-1 (client merges before sending)
    const secondReq = createAuthenticatedPatchRequest(
      url,
      {
        elements: [
          { id: "el1", type: "rectangle", x: 0, y: 0, width: 100, height: 100 },
          { id: "el2", type: "ellipse", x: 200, y: 0, width: 50, height: 50 },
        ],
        appState: { viewBackgroundColor: "#ffffff", gridSize: null },
        files: {
          "file-1": { id: "file-1", mimeType: "image/png", s3Key: "uploads/file-1.png" },
          "file-2": { id: "file-2", mimeType: "image/jpeg", s3Key: "uploads/file-2.jpg" },
        },
        expectedVersion: 1,
        broadcast: false,
        senderId: "sender-1",
      },
      testUser
    );

    const secondRes = await PATCH(secondReq, { params: Promise.resolve({ whiteboardId }) });
    expect(secondRes.status).toBe(200);
    const secondResult = await secondRes.json();
    expect(secondResult.data.version).toBe(2);

    // Both files should be present
    const afterSecond = await db.whiteboard.findUnique({ where: { id: whiteboardId } });
    expect(afterSecond?.files).toMatchObject({
      "file-1": { id: "file-1", mimeType: "image/png", s3Key: "uploads/file-1.png" },
      "file-2": { id: "file-2", mimeType: "image/jpeg", s3Key: "uploads/file-2.jpg" },
    });
    expect(afterSecond?.version).toBe(2);
  });

  it("returns 409 with stale:true and currentVersion when expectedVersion is stale", async () => {
    const whiteboardId = testWhiteboard.id;

    // Pre-advance the whiteboard version in DB to 3
    await db.whiteboard.update({
      where: { id: whiteboardId },
      data: { version: 3 },
    });

    const url = `http://localhost/api/whiteboards/${whiteboardId}`;
    const req = createAuthenticatedPatchRequest(
      url,
      {
        elements: [{ id: "el-stale" }],
        appState: { viewBackgroundColor: "#ffffff", gridSize: null },
        files: {},
        expectedVersion: 1, // stale — DB is at 3
        broadcast: false,
        senderId: "sender-stale",
      },
      testUser
    );

    const res = await PATCH(req, { params: Promise.resolve({ whiteboardId }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.stale).toBe(true);
    expect(body.currentVersion).toBe(3);
  });

  it("increments version on each successful save", async () => {
    const whiteboardId = testWhiteboard.id;
    const url = `http://localhost/api/whiteboards/${whiteboardId}`;

    for (let i = 0; i < 3; i++) {
      const req = createAuthenticatedPatchRequest(
        url,
        {
          elements: [{ id: `el${i}` }],
          appState: { viewBackgroundColor: "#ffffff", gridSize: null },
          files: {},
          expectedVersion: i,
          broadcast: false,
          senderId: "sender-loop",
        },
        testUser
      );
      const res = await PATCH(req, { params: Promise.resolve({ whiteboardId }) });
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.version).toBe(i + 1);
    }

    const final = await db.whiteboard.findUnique({ where: { id: whiteboardId } });
    expect(final?.version).toBe(3);
  });

  it("does not overwrite files when only appState is patched (no elements)", async () => {
    const whiteboardId = testWhiteboard.id;

    // Seed with files and version
    await db.whiteboard.update({
      where: { id: whiteboardId },
      data: {
        files: { "file-existing": { id: "file-existing", mimeType: "image/png" } },
        version: 2,
      },
    });

    const url = `http://localhost/api/whiteboards/${whiteboardId}`;

    // Patch only name — no elements, no files
    const req = createAuthenticatedPatchRequest(
      url,
      { name: "Renamed Board" },
      testUser
    );

    const res = await PATCH(req, { params: Promise.resolve({ whiteboardId }) });
    expect(res.status).toBe(200);

    // Files unchanged, version not incremented (no elements update)
    const after = await db.whiteboard.findUnique({ where: { id: whiteboardId } });
    expect(after?.files).toMatchObject({
      "file-existing": { id: "file-existing", mimeType: "image/png" },
    });
    expect(after?.version).toBe(2);
    expect(after?.name).toBe("Renamed Board");
  });
});
