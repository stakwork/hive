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
  let testFeature: Awaited<ReturnType<typeof db.features.create>>;
  let testTask: Awaited<ReturnType<typeof db.tasks.create>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Reset mock implementations
    mockGeneratePresignedDownloadUrl.mockResolvedValue(
      "https://mock-s3.example.com/test-screenshot.jpg?expires=123456789"
    );
    
    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({owner_id: testUser.id });

    // Mock session for auth
    vi.mocked(getServerSession).mockResolvedValue({
      user: {
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
      },
    } as any);

    testFeature = await db.features.create({
      data: {
        title: "Test Feature",workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
        phases: {
          create: {
            name: "Phase 1",
            order: 0,
          },
        },
      },
    });

    testTask = await db.tasks.create({
      data: {
        title: "Test Task",workspace_id: testWorkspace.id,feature_id: testFeature.id,created_by_id: testUser.id,updated_by_id: testUser.id,
      },
    });
  });

  afterEach(async () => {
    await db.attachments.deleteMany({ where: { message: {task_id: testTask.id } } });
    await db.chat_messages.deleteMany({ where: {task_id: testTask.id } });
    await db.tasks.delete({ where: { id: testTask.id } });
    await db.phases.deleteMany({ where: {feature_id: testFeature.id } });
    await db.features.delete({ where: { id: testFeature.id } });
    await db.workspace_members.deleteMany({ where: {workspace_id: testWorkspace.id } });
    await db.workspaces.delete({ where: { id: testWorkspace.id } });
    await db.users.delete({ where: { id: testUser.id } });
  });

  it("should return image attachments for feature tasks", async () => {
    // Create a chat message
    const message = await db.chat_messages.create({
      data: {task_id: testTask.id,user_id: testUser.id,
        message: "Task completed",
        role: ChatRole.ASSISTANT,
        status: "SENT",context_tags: "[]",
      },
    });

    // Create image attachments
    await db.attachments.create({
      data: {
        messageId: message.id,
        filename: "screenshot-1.jpg",
        mimeType: "image/jpeg",
        size: 245000,
        path: `attachments/${testWorkspace.id}/${testTask.id}/screenshot-1.jpg`,
      },
    });

    await db.attachments.create({
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
      params: Promise.resolve({feature_id: testFeature.id }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.attachments).toHaveLength(2);
    expect(data.attachments[0]).toMatchObject({
      filename: "screenshot-1.jpg",
      mimeType: "image/jpeg",task_id: testTask.id,
      taskTitle: "Test Task",
    });
    expect(data.attachments[0].url).toBeDefined();
    expect(data.attachments[1]).toMatchObject({
      filename: "screenshot-2.png",
      mimeType: "image/png",task_id: testTask.id,
      taskTitle: "Test Task",
    });
  });

  it("should exclude non-image attachments", async () => {
    const message = await db.chat_messages.create({
      data: {task_id: testTask.id,user_id: testUser.id,
        message: "Task completed",
        role: ChatRole.ASSISTANT,
        status: "SENT",context_tags: "[]",
      },
    });

    // Create image attachment
    await db.attachments.create({
      data: {
        messageId: message.id,
        filename: "screenshot.png",
        mimeType: "image/png",
        size: 245000,
        path: `attachments/${testWorkspace.id}/${testTask.id}/screenshot.png`,
      },
    });

    // Create non-image attachments
    await db.attachments.create({
      data: {
        messageId: message.id,
        filename: "error.log",
        mimeType: "text/plain",
        size: 8500,
        path: `attachments/${testWorkspace.id}/${testTask.id}/error.log`,
      },
    });

    await db.attachments.create({
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
      params: Promise.resolve({feature_id: testFeature.id }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.attachments).toHaveLength(1);
    expect(data.attachments[0].filename).toBe("screenshot.png");
  });

  it("should exclude attachments from deleted tasks", async () => {
    const deletedTask = await db.tasks.create({
      data: {
        title: "Deleted Task",workspace_id: testWorkspace.id,feature_id: testFeature.id,created_by_id: testUser.id,updated_by_id: testUser.id,
        deleted: true,
      },
    });

    const message = await db.chat_messages.create({
      data: {task_id: deletedTask.id,user_id: testUser.id,
        message: "Task completed",
        role: ChatRole.ASSISTANT,
        status: "SENT",context_tags: "[]",
      },
    });

    await db.attachments.create({
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
      params: Promise.resolve({feature_id: testFeature.id }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.attachments).toHaveLength(0);

    // Cleanup
    await db.attachments.deleteMany({ where: { message: {task_id: deletedTask.id } } });
    await db.chat_messages.deleteMany({ where: {task_id: deletedTask.id } });
    await db.tasks.delete({ where: { id: deletedTask.id } });
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
      params: Promise.resolve({feature_id: testFeature.id }),
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
      params: Promise.resolve({feature_id: testFeature.id }),
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
      params: Promise.resolve({feature_id: "non-existent-id" }),
    });

    expect(response.status).toBe(404);
  });
});
