import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/factories";
import { GET } from "@/app/api/features/[featureId]/attachments/route";
import { ChatRole } from "@/lib/chat";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";

// Mock S3Service
const mockGeneratePresignedDownloadUrl = vi.fn();
vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => ({
    generatePresignedDownloadUrl: mockGeneratePresignedDownloadUrl,
  })),
}));

// Mock next-auth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock nextauth lib
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

describe("GET /api/features/[featureId]/attachments", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testFeature: Awaited<ReturnType<typeof db.feature.create>>;
  let testTask: Awaited<ReturnType<typeof db.task.create>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Reset mock implementations
    mockGeneratePresignedDownloadUrl.mockResolvedValue(
      "https://mock-s3.example.com/test-screenshot.jpg?expires=123456789"
    );
    
    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

    // Mock session for auth
    vi.mocked(getServerSession).mockResolvedValue({
      user: {
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
      },
    } as any);

    testFeature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        phases: {
          create: {
            name: "Phase 1",
            order: 0,
          },
        },
      },
    });

    testTask = await db.task.create({
      data: {
        title: "Test Task",
        workspaceId: testWorkspace.id,
        featureId: testFeature.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });
  });

  afterEach(async () => {
    await db.attachment.deleteMany({ where: { message: { taskId: testTask.id } } });
    await db.chatMessage.deleteMany({ where: { taskId: testTask.id } });
    await db.task.delete({ where: { id: testTask.id } });
    await db.phase.deleteMany({ where: { featureId: testFeature.id } });
    await db.feature.delete({ where: { id: testFeature.id } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await db.workspace.delete({ where: { id: testWorkspace.id } });
    await db.user.delete({ where: { id: testUser.id } });
  });

  it("should return image attachments for feature tasks", async () => {
    // Create a chat message
    const message = await db.chatMessage.create({
      data: {
        taskId: testTask.id,
        userId: testUser.id,
        message: "Task completed",
        role: ChatRole.ASSISTANT,
        status: "SENT",
        contextTags: "[]",
      },
    });

    // Create image attachments
    await db.attachment.create({
      data: {
        messageId: message.id,
        filename: "screenshot-1.jpg",
        mimeType: "image/jpeg",
        size: 245000,
        path: `attachments/${testWorkspace.id}/${testTask.id}/screenshot-1.jpg`,
      },
    });

    await db.attachment.create({
      data: {
        messageId: message.id,
        filename: "screenshot-2.png",
        mimeType: "image/png",
        size: 198000,
        path: `attachments/${testWorkspace.id}/${testTask.id}/screenshot-2.png`,
      },
    });

    // Create request with auth
    const headers = new Headers();
    headers.set("x-middleware-user-id", testUser.id);
    if (testUser.email) headers.set("x-middleware-user-email", testUser.email);
    headers.set("x-middleware-user-name", testUser.name || "Test User");
    headers.set("x-middleware-auth-status", "authenticated");
    headers.set("x-middleware-request-id", "test-request-id");
    
    const request = new NextRequest(
      `http://localhost:3000/api/features/${testFeature.id}/attachments`,
      { headers }
    );

    const response = await GET(request, {
      params: Promise.resolve({ featureId: testFeature.id }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.attachments).toHaveLength(2);
    expect(data.attachments[0]).toMatchObject({
      filename: "screenshot-1.jpg",
      mimeType: "image/jpeg",
      taskId: testTask.id,
      taskTitle: "Test Task",
    });
    expect(data.attachments[0].url).toBeDefined();
    expect(data.attachments[1]).toMatchObject({
      filename: "screenshot-2.png",
      mimeType: "image/png",
      taskId: testTask.id,
      taskTitle: "Test Task",
    });
  });

  it("should exclude non-image attachments", async () => {
    const message = await db.chatMessage.create({
      data: {
        taskId: testTask.id,
        userId: testUser.id,
        message: "Task completed",
        role: ChatRole.ASSISTANT,
        status: "SENT",
        contextTags: "[]",
      },
    });

    // Create image attachment
    await db.attachment.create({
      data: {
        messageId: message.id,
        filename: "screenshot.png",
        mimeType: "image/png",
        size: 245000,
        path: `attachments/${testWorkspace.id}/${testTask.id}/screenshot.png`,
      },
    });

    // Create non-image attachments
    await db.attachment.create({
      data: {
        messageId: message.id,
        filename: "error.log",
        mimeType: "text/plain",
        size: 8500,
        path: `attachments/${testWorkspace.id}/${testTask.id}/error.log`,
      },
    });

    await db.attachment.create({
      data: {
        messageId: message.id,
        filename: "config.json",
        mimeType: "application/json",
        size: 3200,
        path: `attachments/${testWorkspace.id}/${testTask.id}/config.json`,
      },
    });

    const headers = new Headers();
    headers.set("x-middleware-user-id", testUser.id);
    if (testUser.email) headers.set("x-middleware-user-email", testUser.email);
    headers.set("x-middleware-user-name", testUser.name || "Test User");
    headers.set("x-middleware-auth-status", "authenticated");
    headers.set("x-middleware-request-id", "test-request-id");
    
    const request = new NextRequest(
      `http://localhost:3000/api/features/${testFeature.id}/attachments`,
      { headers }
    );

    const response = await GET(request, {
      params: Promise.resolve({ featureId: testFeature.id }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.attachments).toHaveLength(1);
    expect(data.attachments[0].filename).toBe("screenshot.png");
  });

  it("should exclude attachments from deleted tasks", async () => {
    const deletedTask = await db.task.create({
      data: {
        title: "Deleted Task",
        workspaceId: testWorkspace.id,
        featureId: testFeature.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        deleted: true,
      },
    });

    const message = await db.chatMessage.create({
      data: {
        taskId: deletedTask.id,
        userId: testUser.id,
        message: "Task completed",
        role: ChatRole.ASSISTANT,
        status: "SENT",
        contextTags: "[]",
      },
    });

    await db.attachment.create({
      data: {
        messageId: message.id,
        filename: "screenshot.png",
        mimeType: "image/png",
        size: 245000,
        path: `attachments/${testWorkspace.id}/${deletedTask.id}/screenshot.png`,
      },
    });

    const headers = new Headers();
    headers.set("x-middleware-user-id", testUser.id);
    if (testUser.email) headers.set("x-middleware-user-email", testUser.email);
    headers.set("x-middleware-user-name", testUser.name || "Test User");
    headers.set("x-middleware-auth-status", "authenticated");
    headers.set("x-middleware-request-id", "test-request-id");
    
    const request = new NextRequest(
      `http://localhost:3000/api/features/${testFeature.id}/attachments`,
      { headers }
    );

    const response = await GET(request, {
      params: Promise.resolve({ featureId: testFeature.id }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.attachments).toHaveLength(0);

    // Cleanup
    await db.attachment.deleteMany({ where: { message: { taskId: deletedTask.id } } });
    await db.chatMessage.deleteMany({ where: { taskId: deletedTask.id } });
    await db.task.delete({ where: { id: deletedTask.id } });
  });

  it("should return empty array when no image attachments exist", async () => {
    const headers = new Headers();
    headers.set("x-middleware-user-id", testUser.id);
    if (testUser.email) headers.set("x-middleware-user-email", testUser.email);
    headers.set("x-middleware-user-name", testUser.name || "Test User");
    headers.set("x-middleware-auth-status", "authenticated");
    headers.set("x-middleware-request-id", "test-request-id");
    
    const request = new NextRequest(
      `http://localhost:3000/api/features/${testFeature.id}/attachments`,
      { headers }
    );

    const response = await GET(request, {
      params: Promise.resolve({ featureId: testFeature.id }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.attachments).toEqual([]);
  });

  it("should return 401 when unauthenticated", async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/features/${testFeature.id}/attachments`
    );

    const response = await GET(request, {
      params: Promise.resolve({ featureId: testFeature.id }),
    });

    expect(response.status).toBe(401);
  });

  it("should return 404 for non-existent feature", async () => {
    const headers = new Headers();
    headers.set("x-middleware-user-id", testUser.id);
    if (testUser.email) headers.set("x-middleware-user-email", testUser.email);
    headers.set("x-middleware-user-name", testUser.name || "Test User");
    headers.set("x-middleware-auth-status", "authenticated");
    headers.set("x-middleware-request-id", "test-request-id");
    
    const request = new NextRequest(
      "http://localhost:3000/api/features/non-existent-id/attachments",
      { headers }
    );

    const response = await GET(request, {
      params: Promise.resolve({ featureId: "non-existent-id" }),
    });

    expect(response.status).toBe(404);
  });
});
