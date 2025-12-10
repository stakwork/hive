/**
 * Integration tests for POST /api/tasks/[taskId]/recording
 * 
 * This endpoint is a webhook receiver for Playwright video uploads from external pod services.
 * Tests cover:
 * - Authentication via x-api-key header (one-time use API key)
 * - Authorization via encrypted task.agentPassword
 * - Multipart file upload validation (video + timestamps)
 * - S3 storage integration
 * - ChatMessage and Artifact creation
 * - One-time key invalidation
 * - Error handling for various failure scenarios
 */

import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/tasks/[taskId]/recording/route";
import { db } from "@/lib/db";
import { createMultipartPostRequest } from "@/__tests__/support/helpers/request-builders";
import {
  generateValidWebMBuffer,
  generateInvalidVideoBuffer,
  generateOversizedVideoBuffer,
  generateTestTimestamps,
  generateInvalidTimestampsJSON,
} from "@/__tests__/support/helpers/video-test-helpers";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import { TaskStatus, WorkflowStatus, ArtifactType, ChatRole } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";

describe("POST /api/tasks/[taskId]/recording", () => {
  let testUser: any;
  let testWorkspace: any;
  let testTask: any;
  let testSwarm: any;
  let validApiKey: string;
  let encryptedApiKey: string;
  const encryptionService = EncryptionService.getInstance();

  beforeEach(async () => {
    // Create test user and workspace
    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

    // Create swarm for workspace (required for S3 path generation)
    testSwarm = await db.swarm.create({
      data: {
        name: `test-swarm-${Date.now()}`,
        swarmId: `swarm-${Date.now()}`,
        workspaceId: testWorkspace.id,
        status: "ACTIVE",
      },
    });

    // Generate one-time API key and encrypt it
    validApiKey = `test-api-key-${Date.now()}`;
    const encryptedData = encryptionService.encryptField("agentPassword", validApiKey);
    encryptedApiKey = JSON.stringify(encryptedData);

    // Create test task with agentPassword for authentication
    testTask = await db.task.create({
      data: {
        title: "Test User Journey Recording",
        description: "Integration test for video upload",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        mode: "agent",
        agentPassword: encryptedApiKey,
      },
    });
  });

  describe("Happy Path", () => {
    it("should successfully upload video and timestamps with valid authentication", async () => {
      // Arrange
      const videoBuffer = generateValidWebMBuffer(1024);
      const timestamps = generateTestTimestamps();
      const timestampsBuffer = Buffer.from(JSON.stringify(timestamps));

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "video", content: videoBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        { "x-api-key": validApiKey }
      );

      // Act
      const response = await POST(request, { params: { taskId: testTask.id } });
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.data.s3Key).toBeDefined();
      expect(responseData.data.messageId).toBeDefined();
      expect(responseData.data.artifactIds).toHaveLength(2);

      // Verify ChatMessage was created
      const message = await db.chatMessage.findUnique({
        where: { id: responseData.data.messageId },
        include: { artifacts: true },
      });

      expect(message).toBeDefined();
      expect(message!.taskId).toBe(testTask.id);
      expect(message!.role).toBe(ChatRole.ASSISTANT);
      expect(message!.message).toContain("Playwright recording uploaded");

      // Verify two artifacts were created (MEDIA + LONGFORM)
      expect(message!.artifacts).toHaveLength(2);
      
      const videoArtifact = message!.artifacts.find(a => a.type === ArtifactType.MEDIA);
      const timestampsArtifact = message!.artifacts.find(a => a.type === ArtifactType.LONGFORM);

      expect(videoArtifact).toBeDefined();
      expect(videoArtifact!.icon).toBe("video");
      expect((videoArtifact!.content as any).s3Key).toBeDefined();
      expect((videoArtifact!.content as any).mediaType).toBe("video");
      expect((videoArtifact!.content as any).filename).toBe("recording.webm");

      expect(timestampsArtifact).toBeDefined();
      expect(timestampsArtifact!.icon).toBe("timestamp");
      expect((timestampsArtifact!.content as any).title).toBe("Test Timestamps");

      // Verify API key was invalidated (one-time use)
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(updatedTask!.agentPassword).toBeNull();
    });
  });

  describe("Authentication Failures", () => {
    it("should return 401 when x-api-key header is missing", async () => {
      // Arrange
      const videoBuffer = generateValidWebMBuffer(1024);
      const timestampsBuffer = Buffer.from(JSON.stringify(generateTestTimestamps()));

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "video", content: videoBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        {} // No x-api-key header
      );

      // Act
      const response = await POST(request, { params: { taskId: testTask.id } });
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(401);
      expect(responseData.error).toBe("Unauthorized");

      // Verify API key was NOT invalidated on failure
      const task = await db.task.findUnique({ where: { id: testTask.id } });
      expect(task!.agentPassword).not.toBeNull();
    });

    it("should return 401 when x-api-key is invalid", async () => {
      // Arrange
      const videoBuffer = generateValidWebMBuffer(1024);
      const timestampsBuffer = Buffer.from(JSON.stringify(generateTestTimestamps()));

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "video", content: videoBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        { "x-api-key": "invalid-api-key-12345" }
      );

      // Act
      const response = await POST(request, { params: { taskId: testTask.id } });
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(401);
      expect(responseData.error).toBe("Unauthorized");

      // Verify API key was NOT invalidated on failure
      const task = await db.task.findUnique({ where: { id: testTask.id } });
      expect(task!.agentPassword).not.toBeNull();
    });
  });

  describe("Authorization Failures", () => {
    it("should return 404 when task does not exist", async () => {
      // Arrange
      const nonExistentTaskId = "non-existent-task-id";
      const videoBuffer = generateValidWebMBuffer(1024);
      const timestampsBuffer = Buffer.from(JSON.stringify(generateTestTimestamps()));

      const request = createMultipartPostRequest(
        `/api/tasks/${nonExistentTaskId}/recording`,
        [
          { name: "video", content: videoBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        { "x-api-key": validApiKey }
      );

      // Act
      const response = await POST(request, { params: { taskId: nonExistentTaskId } });
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(404);
      expect(responseData.error).toBe("Task not found");
    });

    it("should return 401 when task has no agentPassword", async () => {
      // Arrange - Create task without agentPassword
      const taskWithoutPassword = await db.task.create({
        data: {
          title: "Task Without Password",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          agentPassword: null, // No API key set
        },
      });

      const videoBuffer = generateValidWebMBuffer(1024);
      const timestampsBuffer = Buffer.from(JSON.stringify(generateTestTimestamps()));

      const request = createMultipartPostRequest(
        `/api/tasks/${taskWithoutPassword.id}/recording`,
        [
          { name: "video", content: videoBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        { "x-api-key": "any-api-key" }
      );

      // Act
      const response = await POST(request, { params: { taskId: taskWithoutPassword.id } });
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(401);
      expect(responseData.error).toBe("Unauthorized");
    });
  });

  describe("File Validation", () => {
    it("should return 400 when video file is missing", async () => {
      // Arrange - Only timestamps, no video
      const timestampsBuffer = Buffer.from(JSON.stringify(generateTestTimestamps()));

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        { "x-api-key": validApiKey }
      );

      // Act
      const response = await POST(request, { params: { taskId: testTask.id } });
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(responseData.error).toBe("Missing required files");
    });

    it("should return 400 when timestamps file is missing", async () => {
      // Arrange - Only video, no timestamps
      const videoBuffer = generateValidWebMBuffer(1024);

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "video", content: videoBuffer, filename: "recording.webm" },
        ],
        { "x-api-key": validApiKey }
      );

      // Act
      const response = await POST(request, { params: { taskId: testTask.id } });
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(responseData.error).toBe("Missing required files");
    });

    it("should return 400 when video file has invalid format", async () => {
      // Arrange - Invalid video buffer (not WebM)
      const invalidVideoBuffer = generateInvalidVideoBuffer();
      const timestampsBuffer = Buffer.from(JSON.stringify(generateTestTimestamps()));

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "video", content: invalidVideoBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        { "x-api-key": validApiKey }
      );

      // Act
      const response = await POST(request, { params: { taskId: testTask.id } });
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(responseData.error).toBe("Invalid video format");
    });

    it("should return 413 when video file exceeds size limit", async () => {
      // Arrange - Oversized video buffer
      const oversizedBuffer = generateOversizedVideoBuffer(110); // 110MB
      const timestampsBuffer = Buffer.from(JSON.stringify(generateTestTimestamps()));

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "video", content: oversizedBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        { "x-api-key": validApiKey }
      );

      // Act
      const response = await POST(request, { params: { taskId: testTask.id } });
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(413);
      expect(responseData.error).toContain("File too large");
    });

    it("should return 400 when timestamps JSON is invalid", async () => {
      // Arrange - Invalid JSON
      const videoBuffer = generateValidWebMBuffer(1024);
      const invalidJSON = generateInvalidTimestampsJSON();
      const timestampsBuffer = Buffer.from(invalidJSON);

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "video", content: videoBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        { "x-api-key": validApiKey }
      );

      // Act
      const response = await POST(request, { params: { taskId: testTask.id } });
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(responseData.error).toBe("Invalid timestamps JSON");
    });
  });

  describe("Infrastructure Failures", () => {
    it("should return 500 when swarm is not found for workspace", async () => {
      // Arrange - Delete swarm to simulate missing infrastructure
      await db.swarm.delete({ where: { id: testSwarm.id } });

      const videoBuffer = generateValidWebMBuffer(1024);
      const timestampsBuffer = Buffer.from(JSON.stringify(generateTestTimestamps()));

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "video", content: videoBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        { "x-api-key": validApiKey }
      );

      // Act
      const response = await POST(request, { params: { taskId: testTask.id } });
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(500);
      expect(responseData.error).toBe("Internal error");

      // Verify API key was NOT invalidated on infrastructure failure
      const task = await db.task.findUnique({ where: { id: testTask.id } });
      expect(task!.agentPassword).not.toBeNull();
    });
  });

  describe("One-Time Key Invalidation", () => {
    it("should invalidate API key after successful upload", async () => {
      // Arrange
      const videoBuffer = generateValidWebMBuffer(1024);
      const timestampsBuffer = Buffer.from(JSON.stringify(generateTestTimestamps()));

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "video", content: videoBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        { "x-api-key": validApiKey }
      );

      // Act
      await POST(request, { params: { taskId: testTask.id } });

      // Assert - API key should be null
      const task = await db.task.findUnique({ where: { id: testTask.id } });
      expect(task!.agentPassword).toBeNull();
    });

    it("should not invalidate API key on authentication failure", async () => {
      // Arrange
      const videoBuffer = generateValidWebMBuffer(1024);
      const timestampsBuffer = Buffer.from(JSON.stringify(generateTestTimestamps()));

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "video", content: videoBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        { "x-api-key": "wrong-api-key" } // Invalid key
      );

      // Act
      await POST(request, { params: { taskId: testTask.id } });

      // Assert - API key should still exist
      const task = await db.task.findUnique({ where: { id: testTask.id } });
      expect(task!.agentPassword).not.toBeNull();
      expect(task!.agentPassword).toBe(encryptedApiKey);
    });

    it("should not invalidate API key on file validation failure", async () => {
      // Arrange - Invalid video format
      const invalidVideoBuffer = generateInvalidVideoBuffer();
      const timestampsBuffer = Buffer.from(JSON.stringify(generateTestTimestamps()));

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "video", content: invalidVideoBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        { "x-api-key": validApiKey }
      );

      // Act
      await POST(request, { params: { taskId: testTask.id } });

      // Assert - API key should still exist
      const task = await db.task.findUnique({ where: { id: testTask.id } });
      expect(task!.agentPassword).not.toBeNull();
    });
  });

  describe("Response Format", () => {
    it("should return correct response structure on success", async () => {
      // Arrange
      const videoBuffer = generateValidWebMBuffer(1024);
      const timestampsBuffer = Buffer.from(JSON.stringify(generateTestTimestamps()));

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "video", content: videoBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        { "x-api-key": validApiKey }
      );

      // Act
      const response = await POST(request, { params: { taskId: testTask.id } });
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(201);
      expect(responseData).toMatchObject({
        success: true,
        data: {
          s3Key: expect.any(String),
          messageId: expect.any(String),
          artifactIds: expect.arrayContaining([
            expect.any(String),
            expect.any(String),
          ]),
        },
      });

      // Verify s3Key follows expected pattern: recordings/workspace/swarm/task/timestamp_randomId_recording.webm
      expect(responseData.data.s3Key).toMatch(
        new RegExp(`^recordings/${testWorkspace.id}/${testSwarm.id}/${testTask.id}/\\d+_[a-z0-9]+_recording\\.webm$`)
      );
    });

    it("should return correct error structure on failure", async () => {
      // Arrange - Missing x-api-key
      const videoBuffer = generateValidWebMBuffer(1024);
      const timestampsBuffer = Buffer.from(JSON.stringify(generateTestTimestamps()));

      const request = createMultipartPostRequest(
        `/api/tasks/${testTask.id}/recording`,
        [
          { name: "video", content: videoBuffer, filename: "recording.webm" },
          { name: "timestamps", content: timestampsBuffer, filename: "timestamps.json" },
        ],
        {} // No API key
      );

      // Act
      const response = await POST(request, { params: { taskId: testTask.id } });
      const responseData = await response.json();

      // Assert
      expect(response.status).toBe(401);
      expect(responseData).toMatchObject({
        error: expect.any(String),
      });
      expect(responseData.success).toBeUndefined();
    });
  });
});
