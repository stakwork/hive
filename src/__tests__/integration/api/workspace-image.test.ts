import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST as uploadUrlPost } from "@/app/api/workspaces/[slug]/image/upload-url/route";
import { POST as confirmPost } from "@/app/api/workspaces/[slug]/image/confirm/route";
import { GET as imageGet, DELETE as imageDelete } from "@/app/api/workspaces/[slug]/image/route";
import { db } from "@/lib/db";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectNotFound,
  expectForbidden,
  expectBadRequest,
  getMockedSession,
  createPostRequest,
  createGetRequest,
  createDeleteRequest,
} from "@/__tests__/support/helpers";
import * as s3Module from "@/services/s3";

// Mock S3 service
vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(),
  S3Service: vi.fn(),
}));

describe("Workspace Image API Integration Tests", () => {
  let mockS3Service: {
    validateWorkspaceImageType: ReturnType<typeof vi.fn>;
    validateWorkspaceImageSize: ReturnType<typeof vi.fn>;
    generateWorkspaceImagePath: ReturnType<typeof vi.fn>;
    generatePresignedUploadUrl: ReturnType<typeof vi.fn>;
    generatePresignedDownloadUrl: ReturnType<typeof vi.fn>;
    deleteObject: ReturnType<typeof vi.fn>;
  };

  async function createTestWorkspace() {
    const scenario = await createTestWorkspaceScenario({
      members: [{ role: "ADMIN" }, { role: "DEVELOPER" }],
    });

    return {
      ownerUser: scenario.owner,
      adminUser: scenario.members[0],
      memberUser: scenario.members[1],
      workspace: scenario.workspace,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up mock S3 service
    mockS3Service = {
      validateWorkspaceImageType: vi.fn().mockReturnValue(true),
      validateWorkspaceImageSize: vi.fn().mockReturnValue(true),
      generateWorkspaceImagePath: vi.fn().mockReturnValue("workspaces/test-id/123456.png"),
      generatePresignedUploadUrl: vi.fn().mockResolvedValue("https://s3.example.com/upload-url"),
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/download-url"),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(s3Module.getS3Service).mockReturnValue(mockS3Service as any);
  });

  describe("POST /api/workspaces/[slug]/image/upload-url", () => {
    test("should generate upload URL successfully as owner", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const requestData = {
        contentType: "image/png",
        filename: "workspace-logo.png",
        fileSize: 1024 * 1024, // 1MB
      };

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/image/upload-url`,
        requestData
      );

      const response = await uploadUrlPost(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.uploadUrl).toBe("https://s3.example.com/upload-url");
      expect(data.s3Key).toBe("workspaces/test-id/123456.png");
      expect(data.expiresIn).toBe(900);

      expect(mockS3Service.validateWorkspaceImageType).toHaveBeenCalledWith("image/png");
      expect(mockS3Service.validateWorkspaceImageSize).toHaveBeenCalledWith(1024 * 1024);
      expect(mockS3Service.generateWorkspaceImagePath).toHaveBeenCalledWith(
        workspace.id,
        "workspace-logo.png"
      );
    });

    test("should generate upload URL successfully as admin", async () => {
      const { adminUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const requestData = {
        contentType: "image/jpeg",
        filename: "logo.jpg",
        fileSize: 2 * 1024 * 1024, // 2MB
      };

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/image/upload-url`,
        requestData
      );

      const response = await uploadUrlPost(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.uploadUrl).toBeDefined();
      expect(data.s3Key).toBeDefined();
    });

    test("should return 403 for non-admin/owner user", async () => {
      const { memberUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      const requestData = {
        contentType: "image/png",
        filename: "logo.png",
        fileSize: 1024 * 1024,
      };

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/image/upload-url`,
        requestData
      );

      const response = await uploadUrlPost(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectForbidden(response, "Only workspace admins and owners");
    });

    test("should return 401 for unauthenticated request", async () => {
      const { workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const requestData = {
        contentType: "image/png",
        filename: "logo.png",
        fileSize: 1024 * 1024,
      };

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/image/upload-url`,
        requestData
      );

      const response = await uploadUrlPost(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectUnauthorized(response);
    });

    test("should return 400 for invalid file type", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));
      mockS3Service.validateWorkspaceImageType.mockReturnValue(false);

      const requestData = {
        contentType: "application/pdf",
        filename: "document.pdf",
        fileSize: 1024 * 1024,
      };

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/image/upload-url`,
        requestData
      );

      const response = await uploadUrlPost(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectBadRequest(response, "Invalid file type");
    });

    test("should return 400 for file exceeding size limit", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));
      mockS3Service.validateWorkspaceImageSize.mockReturnValue(false);

      const requestData = {
        contentType: "image/png",
        filename: "large-image.png",
        fileSize: 10 * 1024 * 1024, // 10MB
      };

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/image/upload-url`,
        requestData
      );

      const response = await uploadUrlPost(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectBadRequest(response, "File size exceeds 5MB limit");
    });

    test("should return 400 for missing required fields", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const requestData = {
        contentType: "image/png",
        // Missing filename and fileSize
      };

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/image/upload-url`,
        requestData
      );

      const response = await uploadUrlPost(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectBadRequest(response, "required");
    });
  });

  describe("POST /api/workspaces/[slug]/image/confirm", () => {
    test("should confirm upload and save S3 key to database", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const requestData = {
        s3Key: "workspaces/test-id/123456.png",
      };

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/image/confirm`,
        requestData
      );

      const response = await confirmPost(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.s3Key).toBe("workspaces/test-id/123456.png");

      // Verify database was updated
      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(updatedWorkspace?.imageS3Key).toBe("workspaces/test-id/123456.png");
    });

    test("should delete old image when uploading new one", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      // Set an existing image
      await db.workspace.update({
        where: { id: workspace.id },
        data: { imageS3Key: "workspaces/old-image.png" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const requestData = {
        s3Key: "workspaces/new-image.png",
      };

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/image/confirm`,
        requestData
      );

      const response = await confirmPost(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectSuccess(response);

      // Verify old image was deleted from S3
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith("workspaces/old-image.png");

      // Verify database was updated with new key
      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(updatedWorkspace?.imageS3Key).toBe("workspaces/new-image.png");
    });

    test("should return 403 for non-admin/owner user", async () => {
      const { memberUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      const requestData = {
        s3Key: "workspaces/test.png",
      };

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/image/confirm`,
        requestData
      );

      const response = await confirmPost(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectForbidden(response, "Only workspace admins and owners");
    });
  });

  describe("GET /api/workspaces/[slug]/image", () => {
    test("should return pre-signed download URL for workspace with image", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      // Set workspace image
      await db.workspace.update({
        where: { id: workspace.id },
        data: { imageS3Key: "workspaces/test-image.png" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/image`);

      const response = await imageGet(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.imageUrl).toBe("https://s3.example.com/download-url");
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        "workspaces/test-image.png",
        3600
      );
    });

    test("should return null for workspace without image", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/image`);

      const response = await imageGet(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.imageUrl).toBeNull();
      expect(mockS3Service.generatePresignedDownloadUrl).not.toHaveBeenCalled();
    });

    test("should allow any workspace member to view image", async () => {
      const { memberUser, workspace } = await createTestWorkspace();

      // Set workspace image
      await db.workspace.update({
        where: { id: workspace.id },
        data: { imageS3Key: "workspaces/test-image.png" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      const request = createGetRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/image`);

      const response = await imageGet(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.imageUrl).toBeDefined();
    });

    test("should return 401 for unauthenticated request", async () => {
      const { workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/image`);

      const response = await imageGet(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectUnauthorized(response);
    });
  });

  describe("DELETE /api/workspaces/[slug]/image", () => {
    test("should delete image successfully as owner", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      // Set workspace image
      await db.workspace.update({
        where: { id: workspace.id },
        data: { imageS3Key: "workspaces/test-image.png" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createDeleteRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/image`);

      const response = await imageDelete(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);

      // Verify S3 deletion was called
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith("workspaces/test-image.png");

      // Verify database was updated
      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(updatedWorkspace?.imageS3Key).toBeNull();
    });

    test("should delete image successfully as admin", async () => {
      const { adminUser, workspace } = await createTestWorkspace();

      // Set workspace image
      await db.workspace.update({
        where: { id: workspace.id },
        data: { imageS3Key: "workspaces/test-image.png" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const request = createDeleteRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/image`);

      const response = await imageDelete(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectSuccess(response);
    });

    test("should return 403 for non-admin/owner user", async () => {
      const { memberUser, workspace } = await createTestWorkspace();

      // Set workspace image
      await db.workspace.update({
        where: { id: workspace.id },
        data: { imageS3Key: "workspaces/test-image.png" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      const request = createDeleteRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/image`);

      const response = await imageDelete(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectForbidden(response, "Only workspace admins and owners");

      // Verify image was not deleted
      const unchangedWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(unchangedWorkspace?.imageS3Key).toBe("workspaces/test-image.png");
    });

    test("should return 404 when workspace has no image", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createDeleteRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/image`);

      const response = await imageDelete(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectNotFound(response, "Workspace has no image to delete");
    });

    test("should return 401 for unauthenticated request", async () => {
      const { workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createDeleteRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/image`);

      const response = await imageDelete(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectUnauthorized(response);
    });
  });
});
