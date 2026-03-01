import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/features/[featureId]/attachments/route";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { 
  createAuthenticatedGetRequest,
  createGetRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Feature, Task, ChatMessage } from "@prisma/client";

// Mock S3 service
vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => ({
    generatePresignedDownloadUrl: vi.fn(async (path: string) => {
      return `https://s3.example.com/${path}?presigned=true`;
    }),
  })),
}));

describe("GET /api/features/[featureId]/attachments", () => {
  let user: User;
  let workspace: Workspace;
  let feature: Feature;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test user
    user = await createTestUser({
      name: "Attachments Test User",
      email: `attachments-${generateUniqueId("user")}@example.com`,
    });

    // Create workspace
    workspace = await createTestWorkspace({
      name: "Attachments Workspace",
      slug: `attachments-${generateUniqueId("workspace")}`,
      ownerId: user.id,
    });

    // Create workspace member
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
      },
    });

    // Create feature
    feature = await db.feature.create({
      data: {
        title: "Test Feature with Attachments",
        brief: "Test feature for attachments",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
      },
    });
  });

  describe("Authentication & Authorization", () => {
    it("should return 401 when no session provided", async () => {
      const request = createGetRequest(
        `http://localhost:3000/api/features/${feature.id}/attachments`
      );

      const response = await GET(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(401);
    });

    it("should return 403 when user is not a workspace member", async () => {
      // Create another user who is not a member of the workspace
      const otherUser = await createTestUser({
        name: "Other User",
        email: `other-${generateUniqueId("user")}@example.com`,
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${feature.id}/attachments`,
        otherUser
      );

      const response = await GET(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(403);
    });

    it("should return 404 for non-existent feature", async () => {
      const nonExistentFeatureId = generateUniqueId("non-existent-feature");

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${nonExistentFeatureId}/attachments`,
        user
      );

      const response = await GET(request, {
        params: Promise.resolve({ featureId: nonExistentFeatureId }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("Successful Attachment Retrieval", () => {
    it("should return attachments with presigned URLs", async () => {
      // Create task linked to feature
      const task = await db.task.create({
        data: {
          title: "Test Task",
          description: "Test task description",
          status: "TODO",
          workspaceId: workspace.id,
          featureId: feature.id,
          workflowStatus: "PENDING",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create chat message
      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Test message",
          role: "USER",
        },
      });

      // Create image attachment
      await db.attachment.create({
        data: {
          messageId: message.id,
          path: "attachments/test-image.png",
          filename: "test-image.png",
          mimeType: "image/png",
          size: 1024,
        },
      });

      // Create video attachment
      await db.attachment.create({
        data: {
          messageId: message.id,
          path: "attachments/test-video.mp4",
          filename: "test-video.mp4",
          mimeType: "video/mp4",
          size: 2048,
        },
      });

      // Create non-image/video attachment (should be filtered out)
      await db.attachment.create({
        data: {
          messageId: message.id,
          path: "attachments/test-doc.pdf",
          filename: "test-doc.pdf",
          mimeType: "application/pdf",
          size: 512,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${feature.id}/attachments`,
        user
      );

      const response = await GET(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.attachments).toBeDefined();
      expect(Array.isArray(data.attachments)).toBe(true);
      expect(data.attachments.length).toBe(2); // Only image and video, not PDF

      // Check image attachment
      const imageAttachment = data.attachments.find(
        (att: any) => att.mimeType === "image/png"
      );
      expect(imageAttachment).toBeDefined();
      expect(imageAttachment.filename).toBe("test-image.png");
      expect(imageAttachment.taskId).toBe(task.id);
      expect(imageAttachment.taskTitle).toBe("Test Task");
      expect(imageAttachment.url).toContain("https://s3.example.com/");
      expect(imageAttachment.url).toContain("presigned=true");

      // Check video attachment
      const videoAttachment = data.attachments.find(
        (att: any) => att.mimeType === "video/mp4"
      );
      expect(videoAttachment).toBeDefined();
      expect(videoAttachment.filename).toBe("test-video.mp4");
      expect(videoAttachment.taskId).toBe(task.id);
      expect(videoAttachment.taskTitle).toBe("Test Task");
      expect(videoAttachment.url).toContain("https://s3.example.com/");
    });

    it("should return empty array when feature has no attachments", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${feature.id}/attachments`,
        user
      );

      const response = await GET(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.attachments).toBeDefined();
      expect(Array.isArray(data.attachments)).toBe(true);
      expect(data.attachments.length).toBe(0);
    });

    it("should filter out deleted tasks", async () => {
      // Create a normal task with attachments
      const task = await db.task.create({
        data: {
          title: "Normal Task",
          description: "Normal task",
          status: "TODO",
          workspaceId: workspace.id,
          featureId: feature.id,
          workflowStatus: "PENDING",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Normal message",
          role: "USER",
        },
      });

      await db.attachment.create({
        data: {
          messageId: message.id,
          path: "attachments/normal-image.png",
          filename: "normal-image.png",
          mimeType: "image/png",
          size: 1024,
        },
      });

      // Create a deleted task with attachments
      const deletedTask = await db.task.create({
        data: {
          title: "Deleted Task",
          description: "This task is deleted",
          status: "TODO",
          workspaceId: workspace.id,
          featureId: feature.id,
          workflowStatus: "PENDING",
          deleted: true,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const deletedMessage = await db.chatMessage.create({
        data: {
          taskId: deletedTask.id,
          message: "Message in deleted task",
          role: "USER",
        },
      });

      await db.attachment.create({
        data: {
          messageId: deletedMessage.id,
          path: "attachments/deleted-image.png",
          filename: "deleted-image.png",
          mimeType: "image/png",
          size: 1024,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${feature.id}/attachments`,
        user
      );

      const response = await GET(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      // Should only contain attachments from non-deleted tasks
      expect(data.attachments.length).toBe(1);
      expect(data.attachments[0].filename).toBe("normal-image.png");
    });

    it("should handle multiple tasks with attachments", async () => {
      // Create first task
      const task1 = await db.task.create({
        data: {
          title: "First Task",
          description: "First test task",
          status: "TODO",
          workspaceId: workspace.id,
          featureId: feature.id,
          workflowStatus: "PENDING",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const message1 = await db.chatMessage.create({
        data: {
          taskId: task1.id,
          message: "First message",
          role: "USER",
        },
      });

      await db.attachment.create({
        data: {
          messageId: message1.id,
          path: "attachments/task1-image.png",
          filename: "task1-image.png",
          mimeType: "image/png",
          size: 1024,
        },
      });

      // Create second task
      const task2 = await db.task.create({
        data: {
          title: "Second Task",
          description: "Second test task",
          status: "TODO",
          workspaceId: workspace.id,
          featureId: feature.id,
          workflowStatus: "PENDING",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const message2 = await db.chatMessage.create({
        data: {
          taskId: task2.id,
          message: "Second message",
          role: "USER",
        },
      });

      await db.attachment.create({
        data: {
          messageId: message2.id,
          path: "attachments/task2-video.mp4",
          filename: "task2-video.mp4",
          mimeType: "video/mp4",
          size: 2048,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${feature.id}/attachments`,
        user
      );

      const response = await GET(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.attachments.length).toBe(2);

      // Verify different tasks are represented
      const taskIds = new Set(data.attachments.map((att: any) => att.taskId));
      expect(taskIds.size).toBe(2);
      expect(taskIds.has(task1.id)).toBe(true);
      expect(taskIds.has(task2.id)).toBe(true);
    });
  });

  describe("MIME Type Filtering", () => {
    it("should only return image and video attachments", async () => {
      const task = await db.task.create({
        data: {
          title: "Test Task",
          description: "Test task",
          status: "TODO",
          workspaceId: workspace.id,
          featureId: feature.id,
          workflowStatus: "PENDING",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Test message",
          role: "USER",
        },
      });

      // Create various attachment types
      await db.attachment.create({
        data: {
          messageId: message.id,
          path: "attachments/image.png",
          filename: "image.png",
          mimeType: "image/png",
          size: 1024,
        },
      });

      await db.attachment.create({
        data: {
          messageId: message.id,
          path: "attachments/video.mp4",
          filename: "video.mp4",
          mimeType: "video/mp4",
          size: 2048,
        },
      });

      await db.attachment.create({
        data: {
          messageId: message.id,
          path: "attachments/doc.pdf",
          filename: "doc.pdf",
          mimeType: "application/pdf",
          size: 512,
        },
      });

      await db.attachment.create({
        data: {
          messageId: message.id,
          path: "attachments/text.txt",
          filename: "text.txt",
          mimeType: "text/plain",
          size: 256,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${feature.id}/attachments`,
        user
      );

      const response = await GET(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.attachments.length).toBe(2); // Only image and video

      // Verify all attachments are either image or video
      data.attachments.forEach((att: any) => {
        expect(
          att.mimeType.startsWith("image/") || att.mimeType.startsWith("video/")
        ).toBe(true);
      });
    });

    it("should handle various image MIME types", async () => {
      const task = await db.task.create({
        data: {
          title: "Test Task",
          description: "Test task",
          status: "TODO",
          workspaceId: workspace.id,
          featureId: feature.id,
          workflowStatus: "PENDING",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Test message",
          role: "USER",
        },
      });

      // Create attachments with different image MIME types
      const imageMimeTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];

      for (const mimeType of imageMimeTypes) {
        const ext = mimeType.split("/")[1];
        await db.attachment.create({
          data: {
            messageId: message.id,
            path: `attachments/test.${ext}`,
            filename: `test.${ext}`,
            mimeType,
            size: 1024,
          },
        });
      }

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${feature.id}/attachments`,
        user
      );

      const response = await GET(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.attachments.length).toBe(4);

      // Verify all image types are present
      const returnedMimeTypes = new Set(data.attachments.map((att: any) => att.mimeType));
      imageMimeTypes.forEach((mimeType) => {
        expect(returnedMimeTypes.has(mimeType)).toBe(true);
      });
    });

    it("should handle various video MIME types", async () => {
      const task = await db.task.create({
        data: {
          title: "Test Task",
          description: "Test task",
          status: "TODO",
          workspaceId: workspace.id,
          featureId: feature.id,
          workflowStatus: "PENDING",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Test message",
          role: "USER",
        },
      });

      // Create attachments with different video MIME types
      const videoMimeTypes = ["video/mp4", "video/webm", "video/quicktime"];

      for (const mimeType of videoMimeTypes) {
        const ext = mimeType.split("/")[1];
        await db.attachment.create({
          data: {
            messageId: message.id,
            path: `attachments/test.${ext}`,
            filename: `test.${ext}`,
            mimeType,
            size: 2048,
          },
        });
      }

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${feature.id}/attachments`,
        user
      );

      const response = await GET(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.attachments.length).toBe(3);

      // Verify all video types are present
      const returnedMimeTypes = new Set(data.attachments.map((att: any) => att.mimeType));
      videoMimeTypes.forEach((mimeType) => {
        expect(returnedMimeTypes.has(mimeType)).toBe(true);
      });
    });
  });
});
