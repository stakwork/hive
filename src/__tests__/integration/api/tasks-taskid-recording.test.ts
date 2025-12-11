import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/tasks/[taskId]/recording/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { generateUniqueId } from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { createTestTask } from "@/__tests__/support/fixtures/task";
import { createTestSwarm } from "@/__tests__/support/fixtures/swarm";
import type { User, Workspace, Task, Swarm } from "@prisma/client";

// Mock S3 service
const mockS3Service = {
  validateVideoBuffer: vi.fn(),
  generateVideoS3Path: vi.fn(),
  putObject: vi.fn(),
};

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => mockS3Service),
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

const encryptionService = EncryptionService.getInstance();

/**
 * Creates a valid WebM file buffer with proper magic numbers
 */
function createValidWebMBuffer(sizeInBytes: number = 1024): Buffer {
  const buffer = Buffer.alloc(sizeInBytes);
  // WebM magic numbers: 0x1A 0x45 0xDF 0xA3
  buffer[0] = 0x1a;
  buffer[1] = 0x45;
  buffer[2] = 0xdf;
  buffer[3] = 0xa3;
  // Fill rest with dummy data
  for (let i = 4; i < sizeInBytes; i++) {
    buffer[i] = Math.floor(Math.random() * 256);
  }
  return buffer;
}

/**
 * Creates a valid timestamps JSON file
 */
function createValidTimestampsBuffer(): Buffer {
  const timestamps = {
    start: "2023-01-01T00:00:00Z",
    end: "2023-01-01T00:05:00Z",
    duration: 300,
    frames: [
      { time: 0, action: "start" },
      { time: 100, action: "click" },
      { time: 200, action: "navigate" },
    ],
  };
  return Buffer.from(JSON.stringify(timestamps), "utf-8");
}

/**
 * Creates a multipart FormData request
 */
function createMultipartRequest(
  taskId: string,
  apiKey: string,
  videoBuffer?: Buffer,
  timestampsBuffer?: Buffer
): Request {
  const formData = new FormData();

  if (videoBuffer) {
    const videoBlob = new Blob([videoBuffer], { type: "video/webm" });
    formData.append("video", videoBlob, "recording.webm");
  }

  if (timestampsBuffer) {
    const timestampsBlob = new Blob([timestampsBuffer], {
      type: "application/json",
    });
    formData.append("timestamps", timestampsBlob, "timestamps.json");
  }

  const url = `http://localhost:3000/api/tasks/${taskId}/recording`;
  return new Request(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
    },
    body: formData,
  });
}

/**
 * Helper to create encrypted agentPassword for task
 */
async function createTaskWithApiKey(
  workspaceId: string,
  createdById: string,
  apiKey: string
): Promise<{ task: Task; apiKey: string }> {
  const encryptedPassword = encryptionService.encryptField(
    "agentPassword",
    apiKey
  );

  const task = await db.task.create({
    data: {
      title: `Test Task ${generateUniqueId()}`,
      description: "Test task for recording upload",
      workspaceId,
      createdById,
      updatedById: createdById,
      agentPassword: JSON.stringify(encryptedPassword),
    },
  });

  return { task, apiKey };
}

describe("POST /api/tasks/[taskId]/recording", () => {
  let testUser: User;
  let testWorkspace: Workspace;
  let testSwarm: Swarm;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create test data
    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({
      name: "Recording Test Workspace",
      ownerId: testUser.id,
    });
    testSwarm = await createTestSwarm({
      workspaceId: testWorkspace.id,
      name: "test-swarm",
    });

    // Setup default S3 mock responses
    mockS3Service.validateVideoBuffer.mockReturnValue(true);
    mockS3Service.generateVideoS3Path.mockReturnValue(
      "recordings/workspace/swarm/task/123_abc_recording.webm"
    );
    mockS3Service.putObject.mockResolvedValue(undefined);
  });

  describe("Authentication & Authorization", () => {
    test("should return 401 when x-api-key header is missing", async () => {
      const task = await createTestTask({
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      const request = new Request(
        `http://localhost:3000/api/tasks/${task.id}/recording`,
        {
          method: "POST",
          body: new FormData(),
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 when task has no agentPassword", async () => {
      const task = await createTestTask({
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      const videoBuffer = createValidWebMBuffer();
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        "invalid-key",
        videoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 when API key does not match", async () => {
      const correctApiKey = "correct-key-123";
      const wrongApiKey = "wrong-key-456";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        correctApiKey
      );

      const videoBuffer = createValidWebMBuffer();
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        wrongApiKey,
        videoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 404 when task does not exist", async () => {
      const fakeTaskId = generateUniqueId("task");
      const videoBuffer = createValidWebMBuffer();
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        fakeTaskId,
        "any-key",
        videoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: fakeTaskId }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    });

    test("should return 404 when task is soft-deleted", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      // Soft-delete the task
      await db.task.update({
        where: { id: task.id },
        data: { deleted: true },
      });

      const videoBuffer = createValidWebMBuffer();
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        apiKey,
        videoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    });
  });

  describe("Request Validation", () => {
    test("should return 400 when taskId is missing", async () => {
      const request = new Request(`http://localhost:3000/api/tasks//recording`, {
        method: "POST",
        headers: { "x-api-key": "test-key" },
        body: new FormData(),
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: "" }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Task ID required");
    });

    test("should return 400 when video file is missing", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        apiKey,
        undefined, // No video
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Missing required files");
    });

    test("should return 400 when timestamps file is missing", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      const videoBuffer = createValidWebMBuffer();
      const request = createMultipartRequest(
        task.id,
        apiKey,
        videoBuffer,
        undefined // No timestamps
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Missing required files");
    });

    test("should return 400 when timestamps JSON is invalid", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      const videoBuffer = createValidWebMBuffer();
      const invalidTimestamps = Buffer.from("invalid json {{{", "utf-8");
      const request = createMultipartRequest(
        task.id,
        apiKey,
        videoBuffer,
        invalidTimestamps
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid timestamps JSON");
    });
  });

  describe("Video File Validation", () => {
    test("should return 413 when video file exceeds size limit", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      // Create a 101MB video (exceeds default 100MB limit)
      const largeVideoBuffer = createValidWebMBuffer(101 * 1024 * 1024);
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        apiKey,
        largeVideoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(413);
      const data = await response.json();
      expect(data.error).toContain("File too large");
    });

    test("should return 400 when video format is invalid", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      mockS3Service.validateVideoBuffer.mockReturnValue(false);

      const videoBuffer = createValidWebMBuffer();
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        apiKey,
        videoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid video format");
      expect(mockS3Service.validateVideoBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        "video/webm"
      );
    });

    test("should accept video with custom MAX_VIDEO_SIZE_MB", async () => {
      // Set custom limit
      const originalEnv = process.env.MAX_VIDEO_SIZE_MB;
      process.env.MAX_VIDEO_SIZE_MB = "200";

      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      // Create a 150MB video (under custom 200MB limit)
      const largeVideoBuffer = createValidWebMBuffer(150 * 1024 * 1024);
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        apiKey,
        largeVideoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(201);

      // Restore original env
      if (originalEnv) {
        process.env.MAX_VIDEO_SIZE_MB = originalEnv;
      } else {
        delete process.env.MAX_VIDEO_SIZE_MB;
      }
    });
  });

  describe("S3 Upload & Database Persistence", () => {
    test("should upload video to S3 and create chat message with artifacts", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      const videoBuffer = createValidWebMBuffer(1024 * 1024); // 1MB
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        apiKey,
        videoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();

      // Verify response structure
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty("s3Key");
      expect(data.data).toHaveProperty("messageId");
      expect(data.data).toHaveProperty("artifactIds");
      expect(data.data.artifactIds).toHaveLength(2); // video + timestamps

      // Verify S3 upload was called
      expect(mockS3Service.putObject).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        "video/webm"
      );
      expect(mockS3Service.generateVideoS3Path).toHaveBeenCalledWith(
        testWorkspace.id,
        testSwarm.id,
        task.id
      );

      // Verify chat message was created
      const chatMessage = await db.chatMessage.findUnique({
        where: { id: data.data.messageId },
        include: { artifacts: true },
      });

      expect(chatMessage).toBeTruthy();
      expect(chatMessage?.message).toBe("Playwright recording uploaded");
      expect(chatMessage?.role).toBe("ASSISTANT");
      expect(chatMessage?.status).toBe("SENT");
      expect(chatMessage?.taskId).toBe(task.id);

      // Verify artifacts were created
      expect(chatMessage?.artifacts).toHaveLength(2);

      // Verify video artifact
      const videoArtifact = chatMessage?.artifacts.find(
        (a) => a.type === "MEDIA"
      );
      expect(videoArtifact).toBeTruthy();
      expect(videoArtifact?.icon).toBe("video");
      const videoContent = videoArtifact?.content as any;
      expect(videoContent.s3Key).toBeTruthy();
      expect(videoContent.mediaType).toBe("video");
      expect(videoContent.filename).toBe("recording.webm");
      expect(videoContent.size).toBe(1024 * 1024);
      expect(videoContent.contentType).toBe("video/webm");

      // Verify timestamps artifact
      const timestampsArtifact = chatMessage?.artifacts.find(
        (a) => a.type === "LONGFORM"
      );
      expect(timestampsArtifact).toBeTruthy();
      expect(timestampsArtifact?.icon).toBe("timestamp");
      const timestampsContent = timestampsArtifact?.content as any;
      expect(timestampsContent.title).toBe("Test Timestamps");
      expect(timestampsContent.text).toContain("start");
    });

    test("should invalidate API key after successful upload", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      const videoBuffer = createValidWebMBuffer();
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        apiKey,
        videoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(201);

      // Verify API key was cleared
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
        select: { agentPassword: true },
      });

      expect(updatedTask?.agentPassword).toBeNull();
    });

    test("should not allow reusing API key after successful upload", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      const videoBuffer = createValidWebMBuffer();
      const timestampsBuffer = createValidTimestampsBuffer();

      // First upload - should succeed
      const request1 = createMultipartRequest(
        task.id,
        apiKey,
        videoBuffer,
        timestampsBuffer
      );
      const response1 = await POST(request1, {
        params: Promise.resolve({ taskId: task.id }),
      });
      expect(response1.status).toBe(201);

      // Second upload with same key - should fail
      const request2 = createMultipartRequest(
        task.id,
        apiKey,
        videoBuffer,
        timestampsBuffer
      );
      const response2 = await POST(request2, {
        params: Promise.resolve({ taskId: task.id }),
      });
      expect(response2.status).toBe(401);
    });

    test("should return 500 when swarm is not found", async () => {
      // Create workspace without swarm
      const workspaceWithoutSwarm = await createTestWorkspace({
        name: "No Swarm Workspace",
        ownerId: testUser.id,
      });

      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        workspaceWithoutSwarm.id,
        testUser.id,
        apiKey
      );

      const videoBuffer = createValidWebMBuffer();
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        apiKey,
        videoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Internal error");
    });

    test("should return 500 when S3 upload fails", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      // Mock S3 upload failure
      mockS3Service.putObject.mockRejectedValue(
        new Error("S3 upload failed")
      );

      const videoBuffer = createValidWebMBuffer();
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        apiKey,
        videoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Upload failed");
    });
  });

  describe("Edge Cases & Error Handling", () => {
    test("should handle malformed multipart data gracefully", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      // Create request with invalid body (not proper FormData)
      const request = new Request(
        `http://localhost:3000/api/tasks/${task.id}/recording`,
        {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "content-type": "multipart/form-data",
          },
          body: "invalid body",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid multipart data");
    });

    test("should handle empty video file", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      const emptyVideoBuffer = Buffer.alloc(0);
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        apiKey,
        emptyVideoBuffer,
        timestampsBuffer
      );

      mockS3Service.validateVideoBuffer.mockReturnValue(false);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid video format");
    });

    test("should handle encrypted agentPassword decryption failure", async () => {
      const task = await db.task.create({
        data: {
          title: "Test Task with Invalid Password",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          agentPassword: "invalid-encrypted-data-not-json",
        },
      });

      const videoBuffer = createValidWebMBuffer();
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        "any-key",
        videoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    test("should preserve artifacts even if key invalidation fails", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      // Mock task.update to fail on key invalidation (simulate DB error)
      const originalUpdate = db.task.update;
      vi.spyOn(db.task, "update").mockImplementation(async (args: any) => {
        if (args.data?.agentPassword === null) {
          throw new Error("DB update failed");
        }
        return originalUpdate(args);
      });

      const videoBuffer = createValidWebMBuffer();
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        apiKey,
        videoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Should still succeed (upload already happened)
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify message was still created
      const chatMessage = await db.chatMessage.findUnique({
        where: { id: data.data.messageId },
        include: { artifacts: true },
      });
      expect(chatMessage).toBeTruthy();
      expect(chatMessage?.artifacts).toHaveLength(2);

      // Restore original method
      vi.restoreAllMocks();
    });

    test("should store s3Key without presigned URL in artifacts", async () => {
      const apiKey = "test-key-123";
      const { task } = await createTaskWithApiKey(
        testWorkspace.id,
        testUser.id,
        apiKey
      );

      const s3KeyPath = "recordings/test/path/video.webm";
      mockS3Service.generateVideoS3Path.mockReturnValue(s3KeyPath);

      const videoBuffer = createValidWebMBuffer();
      const timestampsBuffer = createValidTimestampsBuffer();
      const request = createMultipartRequest(
        task.id,
        apiKey,
        videoBuffer,
        timestampsBuffer
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();

      // Verify artifact stores s3Key, not presigned URL
      const chatMessage = await db.chatMessage.findUnique({
        where: { id: data.data.messageId },
        include: { artifacts: true },
      });

      const videoArtifact = chatMessage?.artifacts.find(
        (a) => a.type === "MEDIA"
      );
      const videoContent = videoArtifact?.content as any;

      expect(videoContent.s3Key).toBe(s3KeyPath);
      expect(videoContent.s3Url).toBeUndefined();
      expect(data.data.s3Key).toBe(s3KeyPath);
    });
  });
});
