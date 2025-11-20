import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/upload/image/route";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  generateUniqueId,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";

// Create mock S3 service methods
const mockS3Service = {
  validateFileType: vi.fn(),
  validateFileSize: vi.fn(),
  generatePresignedUploadUrl: vi.fn(),
  generatePresignedDownloadUrl: vi.fn(),
};

// Mock S3 service to avoid AWS SDK calls
vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => mockS3Service),
}));

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

describe("POST /api/upload/image Integration Tests", () => {
  async function createTestUserWithWorkspaceAndFeature() {
    return await db.$transaction(async (tx) => {
      const testUser = await tx.user.create({
        data: {
          id: generateUniqueId("test-user"),
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const testWorkspace = await tx.workspace.create({
        data: {
          id: generateUniqueId("workspace"),
          name: "Test Workspace",
          slug: generateUniqueId("test-workspace"),
          description: "Test workspace description",
          ownerId: testUser.id,
        },
      });

      const testSwarm = await tx.swarm.create({
        data: {
          swarmId: `swarm-${Date.now()}`,
          name: `test-swarm-${Date.now()}`,
          status: "ACTIVE",
          instanceType: "XL",
          swarmApiKey: "test-api-key",
          swarmUrl: "https://test-swarm.com/api",
          swarmSecretAlias: "test-secret",
          poolName: "test-pool",
          environmentVariables: [],
          services: [],
          workspaceId: testWorkspace.id,
          agentRequestId: null,
          agentStatus: null,
        },
      });

      const testFeature = await tx.feature.create({
        data: {
          id: generateUniqueId("feature"),
          title: "Test Feature",
          brief: "Test feature description",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      return { testUser, testWorkspace, testSwarm, testFeature };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("Authentication Tests", () => {
    test("should return 401 for unauthenticated request", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: "test-feature-id",
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Authentication required");
      expect(mockS3Service.generatePresignedUploadUrl).not.toHaveBeenCalled();
    });

    test("should return 401 for session without user", async () => {
      getMockedSession().mockResolvedValue({
        user: null,
      });

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: "test-feature-id",
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Authentication required" });
    });
  });

  describe("Input Validation Tests", () => {
    test("should return 400 for missing filename", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        // filename missing
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid request data");
      expect(data.details).toBeDefined();
    });

    test("should return 400 for missing contentType", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "test.jpg",
        // contentType missing
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid request data");
      expect(data.details).toBeDefined();
    });

    test("should return 400 for missing size", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        // size missing
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid request data");
      expect(data.details).toBeDefined();
    });

    test("should return 400 for missing featureId", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        // featureId missing
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid request data");
      expect(data.details).toBeDefined();
    });

    test("should return 400 for invalid size (negative)", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: -1, // Invalid negative size
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid request data");
    });

    test("should return 400 for zero byte file size", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "empty.jpg",
        contentType: "image/jpeg",
        size: 0, // Zero bytes
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid request data");
    });
  });

  describe("Feature Access Control Tests", () => {
    test("should return 404 for non-existent feature", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: "non-existent-feature-id",
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Feature not found" });
    });

    test("should return 404 for deleted feature", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();

      // Mark feature as deleted
      await db.feature.update({
        where: { id: testFeature.id },
        data: { deleted: true },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Feature not found" });
    });

    test("should allow workspace owner to upload", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service methods to return success
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url?signature=abc123",
      );
      vi.mocked(mockS3Service.generatePresignedDownloadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url?signature=def456",
      );

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.presignedUrl).toBeDefined();
      expect(data.s3Path).toBeDefined();
      expect(data.publicUrl).toBeDefined();
      expect(data.filename).toBe("test.jpg");
      expect(data.contentType).toBe("image/jpeg");
      expect(data.size).toBe(1024000);
    });
  });

  describe("File Security Tests", () => {
    test("should reject non-image MIME type (PDF)", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service to reject PDF
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(false);

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "document.pdf",
        contentType: "application/pdf",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid file type");
      expect(mockS3Service.validateFileType).toHaveBeenCalledWith("application/pdf");
    });

    test("should reject executable MIME type (JavaScript)", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service to reject JavaScript
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(false);

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "malicious.js",
        contentType: "application/javascript",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid file type");
      expect(mockS3Service.validateFileType).toHaveBeenCalledWith("application/javascript");
    });

    test("should reject files exceeding 10MB size limit", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service to accept file type but reject size
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(false);

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "large-image.jpg",
        contentType: "image/jpeg",
        size: 11 * 1024 * 1024, // 11MB
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("File size exceeds maximum limit");
      expect(mockS3Service.validateFileSize).toHaveBeenCalledWith(11 * 1024 * 1024);
    });

    test("should accept valid image types (JPEG, PNG, GIF, WebP)", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service to accept images
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url",
      );
      vi.mocked(mockS3Service.generatePresignedDownloadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url",
      );

      const imageTypes = [
        { contentType: "image/jpeg", filename: "test.jpg" },
        { contentType: "image/png", filename: "test.png" },
        { contentType: "image/gif", filename: "test.gif" },
        { contentType: "image/webp", filename: "test.webp" },
      ];

      for (const { contentType, filename } of imageTypes) {
        const request = createPostRequest("http://localhost:3000/api/upload/image", {
          featureId: testFeature.id,
          filename,
          contentType,
          size: 1024000,
        });

        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockS3Service.validateFileType).toHaveBeenCalledWith(contentType);
      }
    });
  });

  describe("Path Generation Tests", () => {
    test("should generate S3 path with correct hierarchy for features", async () => {
      const { testUser, testFeature, testWorkspace, testSwarm } =
        await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url",
      );
      vi.mocked(mockS3Service.generatePresignedDownloadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url",
      );

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      // Verify path format: features/{workspaceId}/{swarmId}/{featureId}/{timestamp}_{randomId}_{filename}
      // Note: route uses swarm.id (primary key) not swarm.swarmId field
      expect(data.s3Path).toContain(`features/${testWorkspace.id}`);
      expect(data.s3Path).toContain(testSwarm.id);
      expect(data.s3Path).toContain(testFeature.id);
      expect(data.s3Path).toMatch(/_test\.jpg$/); // Ends with sanitized filename
    });

    test("should sanitize filename with special characters", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url",
      );
      vi.mocked(mockS3Service.generatePresignedDownloadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url",
      );

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "file with spaces & special!chars@.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      // Verify filename is sanitized (special chars replaced with underscores)
      // Original: "file with spaces & special!chars@.jpg"
      // Sanitized: "file_with_spaces___special_chars_.jpg"
      expect(data.s3Path).toMatch(/_file_with_spaces___special_chars_\.jpg$/);
    });

    test("should use default swarmId when swarm is not configured", async () => {
      const testUser = await db.user.create({
        data: {
          id: generateUniqueId("test-user"),
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const testWorkspace = await db.workspace.create({
        data: {
          id: generateUniqueId("workspace"),
          name: "Test Workspace",
          slug: generateUniqueId("test-workspace"),
          description: "Test workspace without swarm",
          ownerId: testUser.id,
        },
      });

      const testFeature = await db.feature.create({
        data: {
          id: generateUniqueId("feature"),
          title: "Test Feature",
          brief: "Test feature description",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url",
      );
      vi.mocked(mockS3Service.generatePresignedDownloadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url",
      );

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      // Verify default swarmId is used when no swarm configured
      expect(data.s3Path).toContain("/default/");
    });

    test("should handle very long filename", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url",
      );
      vi.mocked(mockS3Service.generatePresignedDownloadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url",
      );

      const longFilename = "a".repeat(500) + ".jpg"; // 500+ character filename

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: longFilename,
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.s3Path).toContain("a".repeat(500)); // Long filename preserved in path
    });
  });

  describe("Presigned URL Properties Tests", () => {
    test("should generate presigned URL with correct parameters", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url?signature=abc123",
      );
      vi.mocked(mockS3Service.generatePresignedDownloadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url?signature=def456",
      );

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify upload URL generation (5 minutes = 300 seconds)
      expect(mockS3Service.generatePresignedUploadUrl).toHaveBeenCalledWith(
        expect.stringContaining("features/"),
        "image/jpeg",
        300,
      );

      // Verify download URL generation (1 year = 604800 seconds)
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        expect.stringContaining("features/"),
        604800,
      );

      const data = await response.json();
      expect(data.presignedUrl).toBe(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url?signature=abc123",
      );
      expect(data.publicUrl).toBe(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url?signature=def456",
      );
    });

    test("should include correct Content-Type in presigned URL generation", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url",
      );
      vi.mocked(mockS3Service.generatePresignedDownloadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url",
      );

      const contentTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

      for (const contentType of contentTypes) {
        const request = createPostRequest("http://localhost:3000/api/upload/image", {
          featureId: testFeature.id,
          filename: "test.jpg",
          contentType,
          size: 1024000,
        });

        await POST(request);

        expect(mockS3Service.generatePresignedUploadUrl).toHaveBeenCalledWith(
          expect.any(String),
          contentType,
          300,
        );
      }
    });

    test("should return complete response with all required fields", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url?X-Amz-Signature=abc123",
      );
      vi.mocked(mockS3Service.generatePresignedDownloadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url?X-Amz-Signature=def456",
      );

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "image.png",
        contentType: "image/png",
        size: 2048000,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      // Verify all required response fields
      expect(data).toHaveProperty("presignedUrl");
      expect(data).toHaveProperty("s3Path");
      expect(data).toHaveProperty("publicUrl");
      expect(data).toHaveProperty("filename");
      expect(data).toHaveProperty("contentType");
      expect(data).toHaveProperty("size");

      expect(data.presignedUrl).toBe(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url?X-Amz-Signature=abc123",
      );
      expect(data.publicUrl).toBe(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url?X-Amz-Signature=def456",
      );
      expect(data.filename).toBe("image.png");
      expect(data.contentType).toBe("image/png");
      expect(data.size).toBe(2048000);
      expect(data.s3Path).toContain("features/");
    });
  });

  describe("Error Handling Tests", () => {
    test("should handle S3 service failure gracefully", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service to pass validation but fail on URL generation
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockRejectedValue(
        new Error("AWS SDK Error: Invalid credentials"),
      );

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Internal server error");
    });

    test("should handle database errors gracefully", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Use malformed feature ID to trigger database error
      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: "malformed-feature-id-that-causes-db-error",
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      // Should return 404 for feature not found (database query returns null)
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Feature not found" });
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty filename string", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "", // Empty string
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid request data");
    });

    test("should generate unique paths for concurrent uploads", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url",
      );
      vi.mocked(mockS3Service.generatePresignedDownloadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url",
      );

      // Simulate concurrent uploads of same file
      const request1 = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const request2 = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const [response1, response2] = await Promise.all([POST(request1), POST(request2)]);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      const data1 = await response1.json();
      const data2 = await response2.json();

      // Paths should be different due to timestamp and random ID
      expect(data1.s3Path).not.toBe(data2.s3Path);
    });

    test("should handle filenames with only special characters", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url",
      );
      vi.mocked(mockS3Service.generatePresignedDownloadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url",
      );

      const request = createPostRequest("http://localhost:3000/api/upload/image", {
        featureId: testFeature.id,
        filename: "!@#$%^&*().jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      // Verify all special chars are sanitized to underscores
      expect(data.s3Path).toMatch(/_________\.jpg$/);
    });

    test("should handle MIME type case variations", async () => {
      const { testUser, testFeature } = await createTestUserWithWorkspaceAndFeature();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service to accept any case
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/upload-url",
      );
      vi.mocked(mockS3Service.generatePresignedDownloadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/download-url",
      );

      const caseVariations = ["image/jpeg", "IMAGE/JPEG", "Image/Jpeg"];

      for (const contentType of caseVariations) {
        const request = createPostRequest("http://localhost:3000/api/upload/image", {
          featureId: testFeature.id,
          filename: "test.jpg",
          contentType,
          size: 1024000,
        });

        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockS3Service.validateFileType).toHaveBeenCalledWith(contentType);
      }
    });
  });
});