import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/tasks/[taskId]/recording/route";
import { db } from "@/lib/db";
import { resetDatabase } from "@/__tests__/support/fixtures/database";
import { EncryptionService } from "@/lib/encryption";
import { createTestTask } from "@/__tests__/support/fixtures/task";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { createTestSwarm } from "@/__tests__/support/fixtures/swarm";
import { getS3Service } from "@/services/s3";

// Mock S3 service
vi.mock("@/services/s3", () => {
  const mockPutObject = vi.fn();
  const mockValidateVideoBuffer = vi.fn();
  const mockGenerateVideoS3Path = vi.fn();
  
  return {
    getS3Service: vi.fn(() => ({
      putObject: mockPutObject,
      validateVideoBuffer: mockValidateVideoBuffer,
      generateVideoS3Path: mockGenerateVideoS3Path,
    })),
  };
});

describe("POST /api/tasks/[taskId]/recording", () => {
  const encryptionService = EncryptionService.getInstance();
  
  let workspace: any;
  let owner: any;
  let swarm: any;
  let task: any;
  let validApiKey: string;
  let encryptedApiKey: string;

  // Helper: Create valid WebM video buffer with magic numbers
  const createValidWebMBuffer = (size: number = 1000): Buffer => {
    const buffer = Buffer.alloc(size);
    // WebM EBML magic numbers: 0x1A 0x45 0xDF 0xA3
    buffer[0] = 0x1a;
    buffer[1] = 0x45;
    buffer[2] = 0xdf;
    buffer[3] = 0xa3;
    return buffer;
  };

  // Helper: Create invalid video buffer (non-WebM)
  const createInvalidVideoBuffer = (): Buffer => {
    const buffer = Buffer.alloc(100);
    // MP4 magic numbers instead: 0x00 0x00 0x00 0x18
    buffer[0] = 0x00;
    buffer[1] = 0x00;
    buffer[2] = 0x00;
    buffer[3] = 0x18;
    return buffer;
  };

  // Helper: Create timestamps JSON
  const createTimestampsJson = (): string => {
    return JSON.stringify({
      actions: [
        { action: "click", selector: "#login-button", timestamp: 1000 },
        { action: "type", selector: "#username", value: "test@example.com", timestamp: 2000 },
      ],
      duration: 5000,
    });
  };

  // Helper: Create multipart FormData
  const createFormData = (videoBuffer: Buffer, timestampsJson: string): FormData => {
    const formData = new FormData();
    const videoBlob = new Blob([videoBuffer], { type: "video/webm" });
    const timestampsBlob = new Blob([timestampsJson], { type: "application/json" });
    
    formData.append("video", videoBlob, "recording.webm");
    formData.append("timestamps", timestampsBlob, "timestamps.json");
    
    return formData;
  };

  // Helper: Create POST request
  const createRequest = (taskId: string, formData: FormData, apiKey?: string): Request => {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
    
    return new Request(`http://localhost:3000/api/tasks/${taskId}/recording`, {
      method: "POST",
      body: formData,
      headers,
    });
  };

  beforeEach(async () => {
    await resetDatabase();
    
    // Clear all mocks
    vi.clearAllMocks();

    // Create test user
    owner = await createTestUser({
      email: "owner@example.com",
      name: "Owner User",
    });

    // Create workspace
    workspace = await createTestWorkspace({
      name: "Test Workspace",
      slug: "test-workspace",
      ownerId: owner.id,
    });

    // Create swarm
    swarm = await createTestSwarm({
      name: "test-swarm.sphinx.chat",
      workspaceId: workspace.id,
      status: "ACTIVE",
    });

    // Generate API key and encrypt it
    validApiKey = "test-api-key-12345";
    const encrypted = encryptionService.encryptField("agentPassword", validApiKey);
    encryptedApiKey = JSON.stringify(encrypted);

    // Create task with encrypted agentPassword
    task = await createTestTask({
      title: "Test Task",
      description: "Test task for recording upload",
      workspaceId: workspace.id,
      createdById: owner.id,
      status: "IN_PROGRESS",
      sourceType: "USER_JOURNEY",
    });

    // Update task with encrypted agentPassword
    await db.task.update({
      where: { id: task.id },
      data: { agentPassword: encryptedApiKey },
    });

    // Setup S3 service mocks
    const mockS3 = getS3Service() as any;
    mockS3.validateVideoBuffer.mockReturnValue(true);
    mockS3.generateVideoS3Path.mockReturnValue(
      `recordings/${workspace.id}/${swarm.id}/${task.id}/test_recording.webm`
    );
    mockS3.putObject.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    test("returns 401 when x-api-key header is missing", async () => {
      const formData = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );
      const request = createRequest(task.id, formData); // No API key

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Unauthorized");
    });

    test("returns 401 when x-api-key is incorrect", async () => {
      const formData = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );
      const request = createRequest(task.id, formData, "wrong-api-key");

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Unauthorized");
    });

    test("returns 401 when task has no agentPassword set", async () => {
      // Create task without agentPassword
      const taskNoPassword = await createTestTask({
        title: "Task No Password",
        workspaceId: workspace.id,
        createdById: owner.id,
      });

      const formData = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );
      const request = createRequest(taskNoPassword.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: taskNoPassword.id }),
      });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Unauthorized");
    });
  });

  describe("Request Validation", () => {
    test("returns 400 when taskId is missing", async () => {
      const formData = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );
      const request = createRequest("", formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: "" }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Task ID required");
    });

    test("returns 404 when task does not exist", async () => {
      const nonExistentTaskId = "non-existent-task-id";
      const formData = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );
      const request = createRequest(nonExistentTaskId, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: nonExistentTaskId }),
      });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe("Task not found");
    });
  });

  describe("File Validation", () => {
    test("returns 400 when video file is missing", async () => {
      const formData = new FormData();
      const timestampsBlob = new Blob([createTimestampsJson()], {
        type: "application/json",
      });
      formData.append("timestamps", timestampsBlob, "timestamps.json");

      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Missing required files");
    });

    test("returns 400 when timestamps file is missing", async () => {
      const formData = new FormData();
      const videoBlob = new Blob([createValidWebMBuffer()], {
        type: "video/webm",
      });
      formData.append("video", videoBlob, "recording.webm");

      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Missing required files");
    });

    test("returns 400 when video format is invalid (non-WebM)", async () => {
      const mockS3 = getS3Service() as any;
      mockS3.validateVideoBuffer.mockReturnValue(false); // Simulate invalid format

      const formData = createFormData(
        createInvalidVideoBuffer(),
        createTimestampsJson()
      );
      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid video format");
    });

    test("returns 413 when video file is too large", async () => {
      // Create oversized buffer (e.g., 101MB when default limit is 100MB)
      const oversizedBuffer = createValidWebMBuffer(101 * 1024 * 1024);
      const formData = createFormData(oversizedBuffer, createTimestampsJson());
      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(413);
      const json = await response.json();
      expect(json.error).toContain("File too large");
    });

    test("returns 400 when timestamps JSON is invalid", async () => {
      const formData = new FormData();
      const videoBlob = new Blob([createValidWebMBuffer()], {
        type: "video/webm",
      });
      const invalidJson = "{ invalid json }";
      const timestampsBlob = new Blob([invalidJson], {
        type: "application/json",
      });
      
      formData.append("video", videoBlob, "recording.webm");
      formData.append("timestamps", timestampsBlob, "timestamps.json");

      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid timestamps JSON");
    });
  });

  describe("Valid Upload", () => {
    test("successfully uploads video and creates artifacts with 201 response", async () => {
      const videoBuffer = createValidWebMBuffer(1000);
      const timestampsJson = createTimestampsJson();
      const formData = createFormData(videoBuffer, timestampsJson);
      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(201);
      const json = await response.json();
      
      // Verify response structure
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty("s3Key");
      expect(json.data).toHaveProperty("messageId");
      expect(json.data).toHaveProperty("artifactIds");
      expect(json.data.artifactIds).toHaveLength(2);

      // Verify S3 service calls
      const mockS3 = getS3Service() as any;
      expect(mockS3.generateVideoS3Path).toHaveBeenCalledWith(
        workspace.id,
        swarm.id,
        task.id
      );
      expect(mockS3.putObject).toHaveBeenCalledWith(
        expect.stringContaining("recordings/"),
        expect.any(Buffer),
        "video/webm"
      );
    });

    test("creates ChatMessage with correct taskId and role", async () => {
      const formData = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );
      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(201);
      const json = await response.json();

      // Verify ChatMessage was created
      const chatMessage = await db.chatMessage.findUnique({
        where: { id: json.data.messageId },
        include: { artifacts: true },
      });

      expect(chatMessage).toBeDefined();
      expect(chatMessage?.taskId).toBe(task.id);
      expect(chatMessage?.role).toBe("ASSISTANT");
      expect(chatMessage?.status).toBe("SENT");
      expect(chatMessage?.message).toBe("Playwright recording uploaded");
    });

    test("creates two artifacts (MEDIA and LONGFORM types)", async () => {
      const timestampsJson = createTimestampsJson();
      const formData = createFormData(createValidWebMBuffer(), timestampsJson);
      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(201);
      const json = await response.json();

      // Verify artifacts were created
      const artifacts = await db.artifact.findMany({
        where: {
          id: { in: json.data.artifactIds },
        },
      });

      expect(artifacts).toHaveLength(2);

      // Verify MEDIA artifact
      const mediaArtifact = artifacts.find((a) => a.type === "MEDIA");
      expect(mediaArtifact).toBeDefined();
      expect(mediaArtifact?.icon).toBe("video");
      expect((mediaArtifact?.content as any).s3Key).toContain("recordings/");
      expect((mediaArtifact?.content as any).mediaType).toBe("video");
      expect((mediaArtifact?.content as any).contentType).toBe("video/webm");

      // Verify LONGFORM artifact
      const longformArtifact = artifacts.find((a) => a.type === "LONGFORM");
      expect(longformArtifact).toBeDefined();
      expect(longformArtifact?.icon).toBe("timestamp");
      expect((longformArtifact?.content as any).title).toBe("Test Timestamps");
      expect((longformArtifact?.content as any).text).toBe(
        JSON.stringify(JSON.parse(timestampsJson), null, 2)
      );
    });

    test("invalidates one-time API key after successful upload", async () => {
      const formData = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );
      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(201);

      // Verify agentPassword was set to null
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.agentPassword).toBeNull();
    });

    test("stores correct video metadata in MEDIA artifact", async () => {
      const videoBuffer = createValidWebMBuffer(5000);
      const formData = createFormData(videoBuffer, createTimestampsJson());
      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(201);
      const json = await response.json();

      const mediaArtifact = await db.artifact.findFirst({
        where: {
          id: { in: json.data.artifactIds },
          type: "MEDIA",
        },
      });

      expect(mediaArtifact).toBeDefined();
      const content = mediaArtifact?.content as any;
      expect(content.filename).toBe("recording.webm");
      expect(content.size).toBe(5000);
      expect(content.contentType).toBe("video/webm");
      expect(content.uploadedAt).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    test("returns 500 when S3 putObject fails", async () => {
      const mockS3 = getS3Service() as any;
      mockS3.putObject.mockRejectedValue(new Error("S3 upload failed"));

      const formData = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );
      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.error).toBe("Upload failed");
    });

    test("returns 500 when swarm is not found for workspace", async () => {
      // Delete swarm to trigger error
      await db.swarm.delete({ where: { id: swarm.id } });

      const formData = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );
      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.error).toBe("Internal error");
    });

    test("returns 400 when multipart form data is malformed", async () => {
      // Create request with invalid multipart body
      const request = new Request(
        `http://localhost:3000/api/tasks/${task.id}/recording`,
        {
          method: "POST",
          body: "invalid-multipart-data",
          headers: {
            "x-api-key": validApiKey,
            "content-type": "multipart/form-data; boundary=invalid",
          },
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid multipart data");
    });
  });

  describe("Data Integrity", () => {
    test("does not invalidate API key if upload fails", async () => {
      const mockS3 = getS3Service() as any;
      mockS3.putObject.mockRejectedValue(new Error("S3 upload failed"));

      const formData = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );
      const request = createRequest(task.id, formData, validApiKey);

      await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Verify agentPassword is still set (not invalidated on error)
      const taskAfterError = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(taskAfterError?.agentPassword).toBe(encryptedApiKey);
    });

    test("does not create artifacts if S3 upload fails", async () => {
      const mockS3 = getS3Service() as any;
      mockS3.putObject.mockRejectedValue(new Error("S3 upload failed"));

      const artifactCountBefore = await db.artifact.count();

      const formData = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );
      const request = createRequest(task.id, formData, validApiKey);

      await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const artifactCountAfter = await db.artifact.count();

      // No artifacts should be created if upload fails
      expect(artifactCountAfter).toBe(artifactCountBefore);
    });

    test("stores correct S3 path in artifact for later presigned URL generation", async () => {
      const expectedS3Key = `recordings/${workspace.id}/${swarm.id}/${task.id}/test_recording.webm`;
      const mockS3 = getS3Service() as any;
      mockS3.generateVideoS3Path.mockReturnValue(expectedS3Key);

      const formData = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );
      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(201);
      const json = await response.json();

      // Verify s3Key in response matches expected path
      expect(json.data.s3Key).toBe(expectedS3Key);

      // Verify s3Key stored in artifact
      const mediaArtifact = await db.artifact.findFirst({
        where: {
          id: { in: json.data.artifactIds },
          type: "MEDIA",
        },
      });

      expect((mediaArtifact?.content as any).s3Key).toBe(expectedS3Key);
    });
  });

  describe("Edge Cases", () => {
    test("handles empty video buffer gracefully", async () => {
      // Override mock to actually validate buffer size for this test
      const mockS3 = getS3Service() as any;
      mockS3.validateVideoBuffer.mockImplementation((buffer: Buffer) => {
        // Empty buffer should fail validation
        if (buffer.length < 4) {
          return false;
        }
        // Check magic numbers
        return buffer[0] === 0x1a && buffer[1] === 0x45 && 
               buffer[2] === 0xdf && buffer[3] === 0xa3;
      });

      const emptyBuffer = Buffer.alloc(0);
      const formData = createFormData(emptyBuffer, createTimestampsJson());
      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Should fail validation (buffer too small for magic number check)
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid video format");
    });

    test("handles extremely large timestamps JSON", async () => {
      const largeTimestamps = JSON.stringify({
        actions: Array.from({ length: 10000 }, (_, i) => ({
          action: "click",
          selector: `#element-${i}`,
          timestamp: i * 100,
        })),
        duration: 1000000,
      });

      const formData = createFormData(createValidWebMBuffer(), largeTimestamps);
      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Should succeed - no size limit on timestamps JSON
      expect(response.status).toBe(201);

      const json = await response.json();
      const longformArtifact = await db.artifact.findFirst({
        where: {
          id: { in: json.data.artifactIds },
          type: "LONGFORM",
        },
      });

      expect(longformArtifact).toBeDefined();
      const storedText = (longformArtifact?.content as any).text;
      expect(JSON.parse(storedText).actions).toHaveLength(10000);
    });

    test("handles special characters in video filename", async () => {
      const formData = new FormData();
      const videoBlob = new Blob([createValidWebMBuffer()], {
        type: "video/webm",
      });
      const timestampsBlob = new Blob([createTimestampsJson()], {
        type: "application/json",
      });
      
      formData.append("video", videoBlob, "recording with spaces & special!chars.webm");
      formData.append("timestamps", timestampsBlob, "timestamps.json");

      const request = createRequest(task.id, formData, validApiKey);

      const response = await POST(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response.status).toBe(201);
      const json = await response.json();

      const mediaArtifact = await db.artifact.findFirst({
        where: {
          id: { in: json.data.artifactIds },
          type: "MEDIA",
        },
      });

      expect((mediaArtifact?.content as any).filename).toContain("recording");
    });

    test("handles concurrent upload attempts with different API keys", async () => {
      // Create second task with different API key
      const secondApiKey = "second-api-key-67890";
      const secondEncrypted = JSON.stringify(
        encryptionService.encryptField("agentPassword", secondApiKey)
      );
      
      const task2 = await createTestTask({
        title: "Second Task",
        workspaceId: workspace.id,
        createdById: owner.id,
      });

      await db.task.update({
        where: { id: task2.id },
        data: { agentPassword: secondEncrypted },
      });

      // Upload to both tasks concurrently
      const formData1 = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );
      const formData2 = createFormData(
        createValidWebMBuffer(),
        createTimestampsJson()
      );

      const request1 = createRequest(task.id, formData1, validApiKey);
      const request2 = createRequest(task2.id, formData2, secondApiKey);

      const [response1, response2] = await Promise.all([
        POST(request1, { params: Promise.resolve({ taskId: task.id }) }),
        POST(request2, { params: Promise.resolve({ taskId: task2.id }) }),
      ]);

      // Both should succeed
      expect(response1.status).toBe(201);
      expect(response2.status).toBe(201);

      // Verify both API keys were invalidated
      const [updatedTask1, updatedTask2] = await Promise.all([
        db.task.findUnique({ where: { id: task.id } }),
        db.task.findUnique({ where: { id: task2.id } }),
      ]);

      expect(updatedTask1?.agentPassword).toBeNull();
      expect(updatedTask2?.agentPassword).toBeNull();
    });
  });
});
