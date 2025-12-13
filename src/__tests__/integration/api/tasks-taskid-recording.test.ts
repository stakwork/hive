import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/tasks/[taskId]/recording/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { resetDatabase } from "@/__tests__/support/fixtures/database";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { createTestTask } from "@/__tests__/support/fixtures/task";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectNotFound,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Task, Swarm } from "@prisma/client";

// Mock S3 service
const mockPutObject = vi.fn();
const mockValidateVideoBuffer = vi.fn();
const mockGenerateVideoS3Path = vi.fn();

vi.mock("@/services/s3", () => ({
  getS3Service: () => ({
    putObject: mockPutObject,
    validateVideoBuffer: mockValidateVideoBuffer,
    generateVideoS3Path: mockGenerateVideoS3Path,
  }),
}));

describe("POST /api/tasks/[taskId]/recording - Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    // Setup default S3 mocks
    mockValidateVideoBuffer.mockReturnValue(true);
    mockGenerateVideoS3Path.mockImplementation(
      (workspaceId, swarmId, taskId) => `recordings/${workspaceId}/${swarmId}/${taskId}/video.webm`
    );
    mockPutObject.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await resetDatabase();
  });

  // Helper to create complete test setup with encrypted agentPassword
  async function createTestSetup(options?: { agentPassword?: string; deleted?: boolean }) {
    return await db.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace
      const workspace = await tx.workspace.create({
        data: {
          name: `Test Workspace ${generateUniqueId()}`,
          slug: `workspace-${generateUniqueId()}`,
          ownerId: user.id,
        },
      });

      // Create swarm
      const swarm = await tx.swarm.create({
        data: {
          name: `swarm-${generateUniqueId()}`,
          swarmUrl: "https://test-swarm.example.com",
          poolName: `pool-${generateUniqueId()}`,
          poolApiKey: JSON.stringify(encryptionService.encryptField("poolApiKey", "test-pool-key")),
          swarmApiKey: JSON.stringify(encryptionService.encryptField("swarmApiKey", "test-swarm-key")),
          workspaceId: workspace.id,
        },
      });

      // Encrypt agentPassword if provided
      const agentPasswordField = options?.agentPassword
        ? JSON.stringify(encryptionService.encryptField("agentPassword", options.agentPassword))
        : null;

      // Create task
      const task = await tx.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Test Recording Task",
          description: "Task for testing recording upload",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          sourceType: "USER_JOURNEY",
          status: "IN_PROGRESS",
          workflowStatus: "IN_PROGRESS",
          agentPassword: agentPasswordField,
          deleted: options?.deleted || false,
        },
      });

      return { user, workspace, swarm, task };
    });
  }

  // Helper to create multipart form request
  function createMultipartRequest(
    taskId: string,
    options: {
      apiKey?: string;
      videoBuffer?: Buffer;
      timestampsJson?: Record<string, any>;
      videoFilename?: string;
      timestampsFilename?: string;
      includeVideo?: boolean;
      includeTimestamps?: boolean;
    } = {}
  ): Request {
    const formData = new FormData();

    // Default valid WebM video file (WebM magic numbers: 0x1A 0x45 0xDF 0xA3)
    const defaultVideoBuffer = Buffer.from([
      0x1a, 0x45, 0xdf, 0xa3, // WebM signature
      ...Buffer.alloc(1000, 0), // Padding to make realistic size
    ]);

    const defaultTimestamps = {
      actions: [
        { type: "click", timestamp: 1000, selector: ".button" },
        { type: "input", timestamp: 2000, selector: "#field", value: "test" },
      ],
      duration: 5000,
    };

    // Add video file if requested (default true)
    if (options.includeVideo !== false) {
      const videoBuffer = options.videoBuffer || defaultVideoBuffer;
      const videoBlob = new Blob([videoBuffer], { type: "video/webm" });
      formData.append("video", videoBlob, options.videoFilename || "recording.webm");
    }

    // Add timestamps file if requested (default true)
    if (options.includeTimestamps !== false) {
      const timestamps = options.timestampsJson || defaultTimestamps;
      const timestampsBlob = new Blob([JSON.stringify(timestamps)], {
        type: "application/json",
      });
      formData.append("timestamps", timestampsBlob, options.timestampsFilename || "timestamps.json");
    }

    const headers: Record<string, string> = {};
    if (options.apiKey) {
      headers["x-api-key"] = options.apiKey;
    }

    return new Request(`http://localhost:3000/api/tasks/${taskId}/recording`, {
      method: "POST",
      headers,
      body: formData,
    });
  }

  describe("Authentication & Authorization", () => {
    test("returns 401 when x-api-key header is missing", async () => {
      const { task } = await createTestSetup({ agentPassword: "test-password" });

      const request = createMultipartRequest(task.id, {
        // No apiKey provided
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectUnauthorized(response);
    });

    test("returns 401 when x-api-key header is invalid", async () => {
      const { task } = await createTestSetup({ agentPassword: "correct-password" });

      const request = createMultipartRequest(task.id, {
        apiKey: "wrong-password",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectUnauthorized(response);
    });

    test("returns 401 when task has no agentPassword set", async () => {
      const { task } = await createTestSetup(); // No agentPassword

      const request = createMultipartRequest(task.id, {
        apiKey: "any-password",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectUnauthorized(response);
    });

    test("accepts request with valid x-api-key", async () => {
      const validPassword = "valid-test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectSuccess(response, 201);
    });

    test("returns 404 for non-existent task", async () => {
      const nonExistentTaskId = generateUniqueId("task");

      const request = createMultipartRequest(nonExistentTaskId, {
        apiKey: "any-password",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: nonExistentTaskId }),
      });

      await expectNotFound(response);
    });

    test("returns 404 for soft-deleted task", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({
        agentPassword: validPassword,
        deleted: true,
      });

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectNotFound(response);
    });
  });

  describe("Request Validation", () => {
    test("returns 400 when video file is missing", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
        includeVideo: false, // Missing video
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectError(response, "Missing required files", 400);
    });

    test("returns 400 when timestamps file is missing", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
        includeTimestamps: false, // Missing timestamps
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectError(response, "Missing required files", 400);
    });

    test("returns 400 when timestamps JSON is invalid", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      // Create request with invalid JSON in timestamps
      const formData = new FormData();
      const videoBuffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.alloc(100, 0)]);
      const videoBlob = new Blob([videoBuffer], { type: "video/webm" });
      formData.append("video", videoBlob, "recording.webm");

      // Invalid JSON
      const invalidJson = "{ this is not valid json }";
      const timestampsBlob = new Blob([invalidJson], { type: "application/json" });
      formData.append("timestamps", timestampsBlob, "timestamps.json");

      const request = new Request(`http://localhost:3000/api/tasks/${task.id}/recording`, {
        method: "POST",
        headers: { "x-api-key": validPassword },
        body: formData,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectError(response, "Invalid timestamps JSON", 400);
    });

    test("returns 413 when video file exceeds size limit", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      // Create oversized video buffer (100MB + 1 byte)
      const maxSize = 100 * 1024 * 1024;
      const oversizedBuffer = Buffer.alloc(maxSize + 1, 0);
      // Add WebM magic numbers at start
      oversizedBuffer[0] = 0x1a;
      oversizedBuffer[1] = 0x45;
      oversizedBuffer[2] = 0xdf;
      oversizedBuffer[3] = 0xa3;

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
        videoBuffer: oversizedBuffer,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectError(response, "File too large", 413);
    });

    test("returns 400 when video format is invalid", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      // Mock S3 service to reject invalid format
      mockValidateVideoBuffer.mockReturnValue(false);

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
        videoBuffer: Buffer.from([0xff, 0xd8, 0xff]), // JPEG magic numbers (wrong format)
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectError(response, "Invalid video format", 400);
    });
  });

  describe("Video Upload & Storage", () => {
    test("uploads video to S3 with correct path", async () => {
      const validPassword = "test-password";
      const { task, workspace, swarm } = await createTestSetup({ agentPassword: validPassword });

      const videoBuffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.alloc(1000, 0)]);

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
        videoBuffer,
      });

      await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Verify S3 path generation
      expect(mockGenerateVideoS3Path).toHaveBeenCalledWith(
        workspace.id,
        swarm.id,
        task.id
      );

      // Verify upload to S3
      expect(mockPutObject).toHaveBeenCalledWith(
        expect.stringContaining(task.id),
        expect.any(Buffer),
        "video/webm"
      );
    });

    test("handles S3 upload failure gracefully", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      // Mock S3 upload failure
      mockPutObject.mockRejectedValueOnce(new Error("S3 connection timeout"));

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectError(response, "Upload failed", 500);
    });

    test("returns 500 when swarm not found for workspace", async () => {
      const validPassword = "test-password";
      
      // Create setup without swarm
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        name: "Workspace Without Swarm",
        slug: `no-swarm-${generateUniqueId()}`,
        ownerId: user.id,
      });

      const agentPasswordField = JSON.stringify(
        encryptionService.encryptField("agentPassword", validPassword)
      );

      const task = await createTestTask({
        title: "Task Without Swarm",
        workspaceId: workspace.id,
        createdById: user.id,
      });

      // Update task with agentPassword
      await db.task.update({
        where: { id: task.id },
        data: { agentPassword: agentPasswordField },
      });

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectError(response, "Internal error", 500);
    });
  });

  describe("Database Persistence", () => {
    test("creates ChatMessage with video and timestamps artifacts", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      const videoBuffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.alloc(500, 0)]);
      const timestampsData = {
        actions: [
          { type: "click", timestamp: 1000, selector: ".button" },
          { type: "input", timestamp: 2000, selector: "#field", value: "test" },
        ],
        duration: 3000,
      };

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
        videoBuffer,
        timestampsJson: timestampsData,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const data = await expectSuccess(response, 201);

      // Verify message creation
      const message = await db.chatMessage.findUnique({
        where: { id: data.data.messageId },
        include: { artifacts: true },
      });

      expect(message).toBeDefined();
      expect(message!.message).toBe("Playwright recording uploaded");
      expect(message!.role).toBe("ASSISTANT");
      expect(message!.status).toBe("SENT");
      expect(message!.taskId).toBe(task.id);

      // Verify two artifacts created
      expect(message!.artifacts).toHaveLength(2);

      // Verify video artifact
      const videoArtifact = message!.artifacts.find((a) => a.type === "MEDIA");
      expect(videoArtifact).toBeDefined();
      expect(videoArtifact!.icon).toBe("video");
      expect(videoArtifact!.content).toMatchObject({
        s3Key: expect.stringContaining(task.id),
        mediaType: "video",
        filename: "recording.webm",
        size: videoBuffer.length,
        contentType: "video/webm",
      });

      // Verify timestamps artifact
      const timestampsArtifact = message!.artifacts.find((a) => a.type === "LONGFORM");
      expect(timestampsArtifact).toBeDefined();
      expect(timestampsArtifact!.icon).toBe("timestamp");
      const timestampsContent = timestampsArtifact!.content as any;
      expect(timestampsContent.title).toBe("Test Timestamps");
      expect(timestampsContent.text).toContain("click");
      expect(timestampsContent.text).toContain("input");
    });

    test("invalidates agentPassword after successful upload", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
      });

      await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Verify agentPassword is nullified
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
        select: { agentPassword: true },
      });

      expect(updatedTask!.agentPassword).toBeNull();
    });

    test("prevents reusing API key after first use", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      const request1 = createMultipartRequest(task.id, {
        apiKey: validPassword,
      });

      // First request succeeds
      const response1 = await POST(request1, {
        params: Promise.resolve({ taskId: task.id }),
      });
      await expectSuccess(response1, 201);

      // Second request with same key fails
      const request2 = createMultipartRequest(task.id, {
        apiKey: validPassword,
      });

      const response2 = await POST(request2, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectUnauthorized(response2);
    });

    test("preserves other task fields during upload", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      const originalTitle = task.title;
      const originalStatus = task.status;
      const originalWorkflowStatus = task.workflowStatus;

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
      });

      await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Verify other fields unchanged
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
        select: {
          title: true,
          status: true,
          workflowStatus: true,
          description: true,
        },
      });

      expect(updatedTask!.title).toBe(originalTitle);
      expect(updatedTask!.status).toBe(originalStatus);
      expect(updatedTask!.workflowStatus).toBe(originalWorkflowStatus);
    });
  });

  describe("Response Format", () => {
    test("returns correct success response structure", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const data = await expectSuccess(response, 201);

      // Validate response structure
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("s3Key");
      expect(data.data).toHaveProperty("messageId");
      expect(data.data).toHaveProperty("artifactIds");

      // Validate types
      expect(typeof data.data.s3Key).toBe("string");
      expect(typeof data.data.messageId).toBe("string");
      expect(Array.isArray(data.data.artifactIds)).toBe(true);
      expect(data.data.artifactIds).toHaveLength(2);
    });

    test("returns artifact IDs in response", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const data = await expectSuccess(response, 201);

      // Verify artifacts exist
      const artifacts = await db.artifact.findMany({
        where: { id: { in: data.data.artifactIds } },
      });

      expect(artifacts).toHaveLength(2);
      expect(artifacts.some((a) => a.type === "MEDIA")).toBe(true);
      expect(artifacts.some((a) => a.type === "LONGFORM")).toBe(true);
    });
  });

  describe("Edge Cases & Error Handling", () => {
    test("handles database transaction failure during message creation", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      // Mock database error
      const originalCreate = db.chatMessage.create;
      db.chatMessage.create = vi
        .fn()
        .mockRejectedValueOnce(new Error("Database connection lost"));

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Restore original function
      db.chatMessage.create = originalCreate;

      await expectError(response, "Internal error", 500);
    });

    test("continues if agentPassword invalidation fails", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      // Mock task update failure for invalidation
      const originalUpdate = db.task.update;
      const mockUpdate = vi.fn();
      db.task.update = mockUpdate as any;

      // Let the update succeed for the select, but fail for the invalidation
      mockUpdate.mockImplementation((args: any) => {
        if (args.data?.agentPassword === null) {
          return Promise.reject(new Error("Failed to update task"));
        }
        return originalUpdate.call(db.task, args);
      });

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Restore original function
      db.task.update = originalUpdate;

      // Should still return success even if invalidation fails
      await expectSuccess(response, 201);
    });

    test("handles very large but valid video file", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      // Create large video buffer (50MB - within limit)
      const largeSize = 50 * 1024 * 1024;
      const largeBuffer = Buffer.alloc(largeSize, 0);
      largeBuffer[0] = 0x1a;
      largeBuffer[1] = 0x45;
      largeBuffer[2] = 0xdf;
      largeBuffer[3] = 0xa3;

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
        videoBuffer: largeBuffer,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectSuccess(response, 201);
    });

    test("handles unicode characters in timestamps JSON", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      const timestampsWithUnicode = {
        actions: [
          { type: "click", timestamp: 1000, selector: ".按钮" },
          { type: "input", timestamp: 2000, selector: "#поле", value: "тест 🚀" },
        ],
        duration: 3000,
      };

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
        timestampsJson: timestampsWithUnicode,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const data = await expectSuccess(response, 201);

      // Verify timestamps persisted correctly
      const message = await db.chatMessage.findUnique({
        where: { id: data.data.messageId },
        include: { artifacts: true },
      });

      const timestampsArtifact = message!.artifacts.find((a) => a.type === "LONGFORM");
      const timestampsContent = timestampsArtifact!.content as any;
      
      expect(timestampsContent.text).toContain("按钮");
      expect(timestampsContent.text).toContain("поле");
      expect(timestampsContent.text).toContain("тест 🚀");
    });

    test("handles custom video filename", async () => {
      const validPassword = "test-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      const customFilename = "custom-test-recording-2024.webm";

      const request = createMultipartRequest(task.id, {
        apiKey: validPassword,
        videoFilename: customFilename,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const data = await expectSuccess(response, 201);

      // Verify filename stored in artifact
      const message = await db.chatMessage.findUnique({
        where: { id: data.data.messageId },
        include: { artifacts: true },
      });

      const videoArtifact = message!.artifacts.find((a) => a.type === "MEDIA");
      expect((videoArtifact!.content as any).filename).toBe(customFilename);
    });

    test("handles missing taskId parameter", async () => {
      const validPassword = "test-password";
      await createTestSetup({ agentPassword: validPassword });

      const request = createMultipartRequest("", {
        apiKey: validPassword,
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: "" }),
      });

      await expectError(response, "Task ID required", 400);
    });
  });

  describe("Security & Timing-Safe Comparison", () => {
    test("uses timing-safe comparison for API key validation", async () => {
      const validPassword = "test-password-123456";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      // Test with keys of different lengths (should fail safely)
      const shortKey = "test";
      const request1 = createMultipartRequest(task.id, {
        apiKey: shortKey,
      });

      const response1 = await POST(request1, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectUnauthorized(response1);

      // Test with key of same length but different content
      const sameLength = "test-password-654321";
      const request2 = createMultipartRequest(task.id, {
        apiKey: sameLength,
      });

      const response2 = await POST(request2, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectUnauthorized(response2);
    });

    test("prevents timing attacks by consistent response time", async () => {
      const validPassword = "correct-password";
      const { task } = await createTestSetup({ agentPassword: validPassword });

      // Measure time for completely wrong key
      const start1 = Date.now();
      const request1 = createMultipartRequest(task.id, {
        apiKey: "aaaaaaaaaaaaaaaa",
      });
      await POST(request1, {
        params: Promise.resolve({ taskId: task.id }),
      });
      const duration1 = Date.now() - start1;

      // Measure time for partially correct key
      const start2 = Date.now();
      const request2 = createMultipartRequest(task.id, {
        apiKey: "correct-passwor0",
      });
      await POST(request2, {
        params: Promise.resolve({ taskId: task.id }),
      });
      const duration2 = Date.now() - start2;

      // Timing difference should be minimal (within 50ms)
      expect(Math.abs(duration1 - duration2)).toBeLessThan(50);
    });
  });
});
