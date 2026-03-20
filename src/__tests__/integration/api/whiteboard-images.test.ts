import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST, GET } from "@/app/api/whiteboards/[whiteboardId]/images/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";

const mockS3Service = {
  generateWhiteboardImagePath: vi.fn(),
  generatePresignedUploadUrl: vi.fn(),
  generatePresignedDownloadUrl: vi.fn(),
};

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => mockS3Service),
}));

describe("Whiteboard Images API", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testWhiteboard: Awaited<ReturnType<typeof db.whiteboards.create>>;
  const createdIds: { users: string[]; workspaces: string[]; whiteboards: string[] } = {
    users: [],
    workspaces: [],
    whiteboards: [],
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    testUser = await createTestUser();
    createdIds.users.push(testUser.id);

    testWorkspace = await createTestWorkspace({owner_id: testUser.id });
    createdIds.workspaces.push(testWorkspace.id);

    testWhiteboard = await db.whiteboards.create({
      data: {
        name: "Test Whiteboard",workspace_id: testWorkspace.id,
        elements: [],
        appState: {},
        files: {
          "file-with-s3": {
            id: "file-with-s3",
            s3Key: "whiteboards/ws-1/wb-1/file-with-s3.png",
            mimeType: "image/png",
            created: 1000000,
          },
          "file-legacy": {
            id: "file-legacy",
            dataURL: "data:image/png;base64,abc123",
            mimeType: "image/png",
            created: 999999,
          },
        },
      },
    });
    createdIds.whiteboards.push(testWhiteboard.id);

    // Default S3 mock implementations
    mockS3Service.generateWhiteboardImagePath.mockImplementation(
      (workspaceId: string, whiteboardId: string, fileId: string, mimeType: string) => {
        const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "bin";
        return `whiteboards/${workspaceId}/${whiteboardId}/${fileId}.${ext}`;
      }
    );
    mockS3Service.generatePresignedUploadUrl.mockResolvedValue("https://s3.example.com/upload");
    mockS3Service.generatePresignedDownloadUrl.mockResolvedValue("https://s3.example.com/download");
  });

  afterEach(async () => {
    if (createdIds.whiteboards.length) {
      await db.whiteboards.deleteMany({ where: { id: { in: createdIds.whiteboards } } });
      createdIds.whiteboards.length = 0;
    }
    if (createdIds.workspaces.length) {
      await db.workspaces.deleteMany({ where: { id: { in: createdIds.workspaces } } });
      createdIds.workspaces.length = 0;
    }
    if (createdIds.users.length) {
      await db.users.deleteMany({ where: { id: { in: createdIds.users } } });
      createdIds.users.length = 0;
    }
  });

  // ─── POST ────────────────────────────────────────────────────────────────────

  describe("POST /api/whiteboards/[whiteboardId]/images", () => {
    it("returns 401 when not authenticated", async () => {
      const { NextRequest } = await import("next/server");
      const request = new NextRequest(
        `http://localhost/api/whiteboards/${testWhiteboard.id}/images`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: "file-1", mimeType: "image/png" }),
        }
      );
      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });
      expect(response.status).toBe(401);
    });

    it("returns 403 for a non-member user", async () => {
      const otherUser = await createTestUser();
      createdIds.users.push(otherUser.id);

      const request = createAuthenticatedPostRequest(
        `http://localhost/api/whiteboards/${testWhiteboard.id}/images`,
        otherUser,
        { fileId: "file-1", mimeType: "image/png" }
      );
      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });
      expect(response.status).toBe(403);
    });

    it("returns presignedUploadUrl and s3Key with correct path for owner", async () => {
      const fileId = generateUniqueId("file");

      const request = createAuthenticatedPostRequest(
        `http://localhost/api/whiteboards/${testWhiteboard.id}/images`,
        testUser,
        { fileId, mimeType: "image/png" }
      );
      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.presignedUploadUrl).toBe("https://s3.example.com/upload");
      expect(body.s3Key).toBe(
        `whiteboards/${testWorkspace.id}/${testWhiteboard.id}/${fileId}.png`
      );
      expect(mockS3Service.generatePresignedUploadUrl).toHaveBeenCalledWith(
        body.s3Key,
        "image/png",
        300
      );
    });

    it("returns presignedUploadUrl for workspace member", async () => {
      const member = await createTestUser();
      createdIds.users.push(member.id);
      await db.workspace_members.create({
        data: {workspace_id: testWorkspace.id,user_id: member.id, role: "DEVELOPER" },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost/api/whiteboards/${testWhiteboard.id}/images`,
        member,
        { fileId: "file-member", mimeType: "image/jpeg" }
      );
      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.s3Key).toContain("whiteboards/");
      expect(body.s3Key).toContain(".jpg");
    });

    it("returns 400 when fileId or mimeType is missing", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost/api/whiteboards/${testWhiteboard.id}/images`,
        testUser,
        { fileId: "file-1" } // missing mimeType
      );
      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });
      expect(response.status).toBe(400);
    });

    it("returns 404 for non-existent whiteboard", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost/api/whiteboards/nonexistent-wb/images`,
        testUser,
        { fileId: "file-1", mimeType: "image/png" }
      );
      const response = await POST(request, {
        params: Promise.resolve({ whiteboardId: "nonexistent-wb" }),
      });
      expect(response.status).toBe(404);
    });
  });

  // ─── GET ─────────────────────────────────────────────────────────────────────

  describe("GET /api/whiteboards/[whiteboardId]/images", () => {
    it("returns 401 when not authenticated", async () => {
      const { NextRequest } = await import("next/server");
      const request = new NextRequest(
        `http://localhost/api/whiteboards/${testWhiteboard.id}/images?fileIds=file-with-s3`,
        { method: "GET" }
      );
      const response = await GET(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });
      expect(response.status).toBe(401);
    });

    it("returns 403 for a non-member user", async () => {
      const otherUser = await createTestUser();
      createdIds.users.push(otherUser.id);

      const request = createAuthenticatedGetRequest(
        `http://localhost/api/whiteboards/${testWhiteboard.id}/images`,
        otherUser,
        { fileIds: "file-with-s3" }
      );
      const response = await GET(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });
      expect(response.status).toBe(403);
    });

    it("returns presigned download URLs for fileIds with s3Key", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost/api/whiteboards/${testWhiteboard.id}/images`,
        testUser,
        { fileIds: "file-with-s3" }
      );
      const response = await GET(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body["file-with-s3"]).toBeDefined();
      expect(body["file-with-s3"].presignedDownloadUrl).toBe("https://s3.example.com/download");
      expect(body["file-with-s3"].mimeType).toBe("image/png");
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        "whiteboards/ws-1/wb-1/file-with-s3.png",
        3600
      );
    });

    it("skips legacy base64 entries (no s3Key)", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost/api/whiteboards/${testWhiteboard.id}/images`,
        testUser,
        { fileIds: "file-legacy" }
      );
      const response = await GET(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      // Legacy entry has no s3Key — should be omitted from result
      expect(body["file-legacy"]).toBeUndefined();
      expect(mockS3Service.generatePresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it("handles mixed s3Key and legacy entries — returns only s3 entries", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost/api/whiteboards/${testWhiteboard.id}/images`,
        testUser,
        { fileIds: "file-with-s3,file-legacy" }
      );
      const response = await GET(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body["file-with-s3"]).toBeDefined();
      expect(body["file-legacy"]).toBeUndefined();
    });

    it("skips fileIds not present in stored files gracefully", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost/api/whiteboards/${testWhiteboard.id}/images`,
        testUser,
        { fileIds: "nonexistent-file" }
      );
      const response = await GET(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body["nonexistent-file"]).toBeUndefined();
    });

    it("handles S3 errors gracefully — skips the failing entry", async () => {
      mockS3Service.generatePresignedDownloadUrl.mockRejectedValue(
        new Error("S3 key not found")
      );

      const request = createAuthenticatedGetRequest(
        `http://localhost/api/whiteboards/${testWhiteboard.id}/images`,
        testUser,
        { fileIds: "file-with-s3" }
      );
      const response = await GET(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      // Should not crash — returns empty result
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body["file-with-s3"]).toBeUndefined();
    });

    it("returns 400 when fileIds param is missing", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost/api/whiteboards/${testWhiteboard.id}/images`,
        testUser
      );
      const response = await GET(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });
      expect(response.status).toBe(400);
    });
  });
});
