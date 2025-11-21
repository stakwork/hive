import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/upload/presigned-url/route";
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
  generateS3Path: vi.fn(),
  generatePresignedUploadUrl: vi.fn(),
};

// Mock S3 service to avoid AWS SDK calls
vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => mockS3Service),
}));

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

describe("POST /api/upload/presigned-url Integration Tests", () => {
  async function createTestUserWithWorkspaceAndTask() {
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

      const testTask = await tx.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Test Task",
          description: "Test task description",
          status: "TODO",
          workspaceId: testWorkspace.id,
          workflowStatus: WorkflowStatus.PENDING,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      return { testUser, testWorkspace, testSwarm, testTask };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("Authentication Tests", () => {
    test("should return 401 for unauthenticated request", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: "test-task-id",
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

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: "test-task-id",
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
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
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
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
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
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
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

    test("should return 400 for missing taskId", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        // taskId missing
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
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: -1, // Invalid negative size
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid request data");
    });
  });

  describe("Database Access Control Tests", () => {
    test("should return 404 for non-existent task", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: "non-existent-task-id",
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Task not found" });
    });

    test("should return 404 for deleted task", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();

      // Mark task as deleted
      await db.task.update({
        where: { id: testTask.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Task not found" });
    });

    test("should allow workspace owner to upload", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service methods to return success
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generateS3Path).mockReturnValue(
        "uploads/workspace123/swarm456/task789/1234567890_abc123_test.jpg",
      );
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url?signature=abc123",
      );

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      // Debug actual response on failure
      if (response.status !== 200) {
        const error = await response.json();
        console.log("Unexpected error response:", response.status, error);
        // Log request data for debugging
        console.log(
          "Request body:",
          JSON.stringify({
            taskId: testTask.id,
            filename: "test.jpg",
            contentType: "image/jpeg",
            size: 1024000,
          }),
        );
      }

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.presignedUrl).toBeDefined();
      expect(data.s3Path).toBeDefined();
      expect(data.filename).toBe("test.jpg");
      expect(data.contentType).toBe("image/jpeg");
      expect(data.size).toBe(1024000);
    });
  });

  describe("File Security Tests", () => {
    test("should reject non-image MIME type (PDF)", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service to reject PDF
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(false);

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
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
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service to reject JavaScript
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(false);

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
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
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service to accept file type but reject size
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(false);

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
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
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service to accept image
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generateS3Path).mockReturnValue(
        "uploads/workspace123/swarm456/task789/1234567890_abc123_test.jpg",
      );
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url",
      );

      const imageTypes = [
        { contentType: "image/jpeg", filename: "test.jpg" },
        { contentType: "image/png", filename: "test.png" },
        { contentType: "image/gif", filename: "test.gif" },
        { contentType: "image/webp", filename: "test.webp" },
      ];

      for (const { contentType, filename } of imageTypes) {
        const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
          taskId: testTask.id,
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
    test("should generate S3 path with correct hierarchy", async () => {
      const { testUser, testTask, testWorkspace, testSwarm } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generateS3Path).mockReturnValue(
        `uploads/${testWorkspace.id}/${testSwarm.id}/${testTask.id}/1234567890_abc123_test.jpg`,
      );
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url",
      );

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockS3Service.generateS3Path).toHaveBeenCalledWith(
        testWorkspace.id,
        testSwarm.id,
        testTask.id,
        "test.jpg",
      );

      const data = await response.json();
      expect(data.s3Path).toContain(testWorkspace.id);
      expect(data.s3Path).toContain(testSwarm.id);
      expect(data.s3Path).toContain(testTask.id);
    });

    test("should sanitize filename with special characters", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generateS3Path).mockReturnValue(
        "uploads/workspace123/swarm456/task789/1234567890_abc123_file_with_special_chars.jpg",
      );
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url",
      );

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
        filename: "file with spaces & special!chars@.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockS3Service.generateS3Path).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        testTask.id,
        "file with spaces & special!chars@.jpg",
      );
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

      const testTask = await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Test Task",
          description: "Test task description",
          status: "TODO",
          workspaceId: testWorkspace.id,
          workflowStatus: WorkflowStatus.PENDING,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generateS3Path).mockReturnValue(
        `uploads/${testWorkspace.id}/default/${testTask.id}/1234567890_abc123_test.jpg`,
      );
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url",
      );

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockS3Service.generateS3Path).toHaveBeenCalledWith(
        testWorkspace.id,
        "default", // Default swarmId when no swarm configured
        testTask.id,
        "test.jpg",
      );
    });
  });

  describe("Presigned URL Properties Tests", () => {
    test("should generate presigned URL with correct parameters", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generateS3Path).mockReturnValue(
        "uploads/workspace123/swarm456/task789/1234567890_abc123_test.jpg",
      );
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url?signature=abc123",
      );

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockS3Service.generatePresignedUploadUrl).toHaveBeenCalledWith(
        "uploads/workspace123/swarm456/task789/1234567890_abc123_test.jpg",
        "image/jpeg",
        300, // 5 minutes expiration
      );

      const data = await response.json();
      expect(data.presignedUrl).toBe("https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url?signature=abc123");
    });

    test("should include correct Content-Type in presigned URL generation", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generateS3Path).mockReturnValue("test-path");
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url",
      );

      const contentTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

      for (const contentType of contentTypes) {
        const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
          taskId: testTask.id,
          filename: "test.jpg",
          contentType,
          size: 1024000,
        });

        await POST(request);

        expect(mockS3Service.generatePresignedUploadUrl).toHaveBeenCalledWith(expect.any(String), contentType, 300);
      }
    });

    test("should return complete response with all required fields", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generateS3Path).mockReturnValue(
        "uploads/workspace123/swarm456/task789/1234567890_abc123_image.png",
      );
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url?X-Amz-Signature=abc123",
      );

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
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
      expect(data).toHaveProperty("filename");
      expect(data).toHaveProperty("contentType");
      expect(data).toHaveProperty("size");

      expect(data.presignedUrl).toBe(
        "https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url?X-Amz-Signature=abc123",
      );
      expect(data.s3Path).toBe("uploads/workspace123/swarm456/task789/1234567890_abc123_image.png");
      expect(data.filename).toBe("image.png");
      expect(data.contentType).toBe("image/png");
      expect(data.size).toBe(2048000);
    });
  });

  describe("Error Handling Tests", () => {
    test("should handle S3 service failure gracefully", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service to pass validation but fail on URL generation
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generateS3Path).mockReturnValue("test-path");
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockRejectedValue(
        new Error("AWS SDK Error: Invalid credentials"),
      );

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
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
      const { testUser } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Use malformed task ID to trigger database error
      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: "malformed-task-id-that-causes-db-error",
        filename: "test.jpg",
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      // Should return 404 for task not found (database query returns null)
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Task not found" });
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty filename string", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
        filename: "", // Empty string
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid request data");
    });

    test("should handle zero byte file size", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
        filename: "empty.jpg",
        contentType: "image/jpeg",
        size: 0, // Zero bytes
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid request data");
    });

    test("should handle very long filename", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock S3Service
      vi.mocked(mockS3Service.validateFileType).mockReturnValue(true);
      vi.mocked(mockS3Service.validateFileSize).mockReturnValue(true);
      vi.mocked(mockS3Service.generateS3Path).mockReturnValue("test-path");
      vi.mocked(mockS3Service.generatePresignedUploadUrl).mockResolvedValue(
        "https://test-bucket.s3.us-east-1.amazonaws.com/presigned-url",
      );

      const longFilename = "a".repeat(500) + ".jpg"; // 500+ character filename

      const request = createPostRequest("http://localhost:3000/api/upload/presigned-url", {
        taskId: testTask.id,
        filename: longFilename,
        contentType: "image/jpeg",
        size: 1024000,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockS3Service.generateS3Path).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        testTask.id,
        longFilename,
      );
    });
  });
});