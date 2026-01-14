import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/w/[slug]/chat/share/route";
import { GET } from "@/app/api/w/[slug]/chat/shared/[shareId]/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectUnauthorized,
  generateUniqueId,
  createPostRequest,
  createGetRequest,
} from "@/__tests__/support/helpers";
import type {
  CreateSharedConversationRequest,
  SharedConversationMessage,
} from "@/types/shared-conversation";

describe("Shared Conversation API Integration Tests", () => {
  let testUser: { id: string; email: string; name: string };
  let otherUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string; name: string };
  let otherWorkspace: { id: string; slug: string; name: string };

  beforeEach(async () => {
    // Create test users
    testUser = await db.user.create({
      data: {
        id: generateUniqueId("test-user"),
        email: `test-${generateUniqueId()}@example.com`,
        name: "Test User",
      },
    });

    otherUser = await db.user.create({
      data: {
        id: generateUniqueId("other-user"),
        email: `other-${generateUniqueId()}@example.com`,
        name: "Other User",
      },
    });

    // Create test workspace with testUser as member
    testWorkspace = await db.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "Test Workspace",
        slug: generateUniqueId("test-workspace"),
        description: "Test workspace description",
        ownerId: testUser.id,
      },
    });

    // Add testUser as workspace member
    await db.workspaceMember.create({
      data: {
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });

    // Create other workspace with otherUser
    otherWorkspace = await db.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "Other Workspace",
        slug: generateUniqueId("other-workspace"),
        description: "Other workspace description",
        ownerId: otherUser.id,
      },
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: otherWorkspace.id,
        userId: otherUser.id,
        role: "OWNER",
      },
    });
  });

  afterEach(async () => {
    // Clean up test data
    await db.sharedConversation.deleteMany({
      where: {
        OR: [
          { workspaceId: testWorkspace.id },
          { workspaceId: otherWorkspace.id },
        ],
      },
    });
    await db.workspaceMember.deleteMany({
      where: {
        OR: [
          { workspaceId: testWorkspace.id },
          { workspaceId: otherWorkspace.id },
        ],
      },
    });
    await db.workspace.deleteMany({
      where: {
        id: { in: [testWorkspace.id, otherWorkspace.id] },
      },
    });
    await db.user.deleteMany({
      where: {
        id: { in: [testUser.id, otherUser.id] },
      },
    });
  });

  describe("POST /api/w/[slug]/chat/share", () => {
    test("should successfully create a shared conversation", async () => {
      const mockSession = createAuthenticatedSession(testUser.id, testUser.email, testUser.name);

      const messages: SharedConversationMessage[] = [
        {
          id: "msg-1",
          content: "Hello, this is a test message",
          role: "user",
          timestamp: new Date().toISOString(),
        },
        {
          id: "msg-2",
          content: "This is an assistant response",
          role: "assistant",
          timestamp: new Date().toISOString(),
        },
      ];

      const requestBody: CreateSharedConversationRequest = {
        messages,
        provenanceData: {
          source: "agent-chat",
          taskId: "task-123",
          workspaceSlug: testWorkspace.slug,
        },
        followUpQuestions: ["What is this?", "How does it work?"],
      };

      const request = createPostRequest(requestBody);
      const params = Promise.resolve({ slug: testWorkspace.slug });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toHaveProperty("shareId");
      expect(data).toHaveProperty("url");
      expect(data.url).toBe(`/w/${testWorkspace.slug}/chat/shared/${data.shareId}`);

      // Verify in database
      const savedConversation = await db.sharedConversation.findUnique({
        where: { id: data.shareId },
      });

      expect(savedConversation).toBeTruthy();
      expect(savedConversation?.workspaceId).toBe(testWorkspace.id);
      expect(savedConversation?.userId).toBe(testUser.id);
      expect(savedConversation?.title).toBe("Hello, this is a test message");
      expect(savedConversation?.messages).toEqual(messages);
      expect(savedConversation?.provenanceData).toEqual(requestBody.provenanceData);
      expect(savedConversation?.followUpQuestions).toEqual(requestBody.followUpQuestions);
    });

    test("should truncate title to 100 characters", async () => {
      const mockSession = createAuthenticatedSession(testUser.id, testUser.email, testUser.name);

      const longMessage = "A".repeat(150);
      const messages: SharedConversationMessage[] = [
        {
          id: "msg-1",
          content: longMessage,
          role: "user",
          timestamp: new Date().toISOString(),
        },
      ];

      const requestBody: CreateSharedConversationRequest = {
        messages,
      };

      const request = createPostRequest(requestBody);
      const params = Promise.resolve({ slug: testWorkspace.slug });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(201);

      const savedConversation = await db.sharedConversation.findUnique({
        where: { id: data.shareId },
      });

      expect(savedConversation?.title).toBe("A".repeat(100) + "...");
      expect(savedConversation?.title?.length).toBe(103); // 100 + "..."
    });

    test("should handle missing followUpQuestions with empty array", async () => {
      const mockSession = createAuthenticatedSession(testUser.id, testUser.email, testUser.name);

      const messages: SharedConversationMessage[] = [
        {
          id: "msg-1",
          content: "Test message",
          role: "user",
          timestamp: new Date().toISOString(),
        },
      ];

      const requestBody: CreateSharedConversationRequest = {
        messages,
        provenanceData: null,
      };

      const request = createPostRequest(requestBody);
      const params = Promise.resolve({ slug: testWorkspace.slug });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(201);

      const savedConversation = await db.sharedConversation.findUnique({
        where: { id: data.shareId },
      });

      expect(savedConversation?.followUpQuestions).toEqual([]);
      expect(savedConversation?.provenanceData).toBeNull();
    });

    test("should return 401 for unauthenticated requests", async () => {
      mockUnauthenticatedSession();

      const requestBody: CreateSharedConversationRequest = {
        messages: [
          {
            id: "msg-1",
            content: "Test",
            role: "user",
            timestamp: new Date().toISOString(),
          },
        ],
      };

      const request = createPostRequest(requestBody);
      const params = Promise.resolve({ slug: testWorkspace.slug });

      const response = await POST(request, { params });

      expectUnauthorized(response);
    });

    test("should return 404 for invalid workspace", async () => {
      const mockSession = createAuthenticatedSession(testUser.id, testUser.email, testUser.name);

      const requestBody: CreateSharedConversationRequest = {
        messages: [
          {
            id: "msg-1",
            content: "Test",
            role: "user",
            timestamp: new Date().toISOString(),
          },
        ],
      };

      const request = createPostRequest(requestBody);
      const params = Promise.resolve({ slug: "invalid-workspace-slug" });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
    });

    test("should return 400 for empty messages array", async () => {
      const mockSession = createAuthenticatedSession(testUser.id, testUser.email, testUser.name);

      const requestBody = {
        messages: [],
      };

      const request = createPostRequest(requestBody);
      const params = Promise.resolve({ slug: testWorkspace.slug });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("messages array is required and must not be empty");
    });

    test("should return 400 for invalid message structure", async () => {
      const mockSession = createAuthenticatedSession(testUser.id, testUser.email, testUser.name);

      const requestBody = {
        messages: [
          {
            id: "msg-1",
            content: "Test",
            // Missing role and timestamp
          },
        ],
      };

      const request = createPostRequest(requestBody);
      const params = Promise.resolve({ slug: testWorkspace.slug });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Each message must have id, content, role, and timestamp");
    });

    test("should return 400 for invalid message role", async () => {
      const mockSession = createAuthenticatedSession(testUser.id, testUser.email, testUser.name);

      const requestBody = {
        messages: [
          {
            id: "msg-1",
            content: "Test",
            role: "invalid",
            timestamp: new Date().toISOString(),
          },
        ],
      };

      const request = createPostRequest(requestBody);
      const params = Promise.resolve({ slug: testWorkspace.slug });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Message role must be 'user' or 'assistant'");
    });

    test("should return 400 for invalid JSON", async () => {
      const mockSession = createAuthenticatedSession(testUser.id, testUser.email, testUser.name);

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-middleware-user-id": testUser.id,
          "x-middleware-user-email": testUser.email,
          "x-middleware-user-name": testUser.name,
          "x-middleware-auth-status": "authenticated",
          "x-middleware-request-id": "test-request-id",
        },
        body: "invalid json",
      });

      const params = Promise.resolve({ slug: testWorkspace.slug });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid JSON in request body");
    });
  });

  describe("GET /api/w/[slug]/chat/shared/[shareId]", () => {
    let sharedConversationId: string;

    beforeEach(async () => {
      // Create a shared conversation for testing
      const messages: SharedConversationMessage[] = [
        {
          id: "msg-1",
          content: "Hello, this is a test message",
          role: "user",
          timestamp: new Date().toISOString(),
        },
        {
          id: "msg-2",
          content: "This is an assistant response",
          role: "assistant",
          timestamp: new Date().toISOString(),
        },
      ];

      const sharedConversation = await db.sharedConversation.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: testUser.id,
          title: "Test Conversation",
          messages,
          provenanceData: { source: "test" },
          followUpQuestions: ["Question 1", "Question 2"],
        },
      });

      sharedConversationId = sharedConversation.id;
    });

    test("should successfully retrieve a shared conversation", async () => {
      const mockSession = createAuthenticatedSession(testUser.id, testUser.email, testUser.name);

      const request = createGetRequest();
      const params = Promise.resolve({
        slug: testWorkspace.slug,
        shareId: sharedConversationId,
      });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe(sharedConversationId);
      expect(data.workspaceId).toBe(testWorkspace.id);
      expect(data.userId).toBe(testUser.id);
      expect(data.title).toBe("Test Conversation");
      expect(data.messages).toHaveLength(2);
      expect(data.provenanceData).toEqual({ source: "test" });
      expect(data.followUpQuestions).toEqual(["Question 1", "Question 2"]);
    });

    test("should return 401 for unauthenticated requests", async () => {
      mockUnauthenticatedSession();

      const request = createGetRequest();
      const params = Promise.resolve({
        slug: testWorkspace.slug,
        shareId: sharedConversationId,
      });

      const response = await GET(request, { params });

      expectUnauthorized(response);
    });

    test("should return 404 for non-existent conversation", async () => {
      const mockSession = createAuthenticatedSession(testUser.id, testUser.email, testUser.name);

      const request = createGetRequest();
      const params = Promise.resolve({
        slug: testWorkspace.slug,
        shareId: "non-existent-id",
      });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Shared conversation not found");
    });

    test("should return 404 for invalid workspace", async () => {
      const mockSession = createAuthenticatedSession(testUser.id, testUser.email, testUser.name);

      const request = createGetRequest();
      const params = Promise.resolve({
        slug: "invalid-workspace",
        shareId: sharedConversationId,
      });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
    });

    test("should return 403 when conversation belongs to different workspace", async () => {
      // Create a conversation in otherWorkspace
      const otherConversation = await db.sharedConversation.create({
        data: {
          workspaceId: otherWorkspace.id,
          userId: otherUser.id,
          title: "Other Conversation",
          messages: [
            {
              id: "msg-1",
              content: "Test",
              role: "user",
              timestamp: new Date().toISOString(),
            },
          ],
          followUpQuestions: [],
        },
      });

      const mockSession = createAuthenticatedSession(testUser.id, testUser.email, testUser.name);

      const request = createGetRequest();
      const params = Promise.resolve({
        slug: testWorkspace.slug,
        shareId: otherConversation.id,
      });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied: conversation belongs to a different workspace");

      // Clean up
      await db.sharedConversation.delete({ where: { id: otherConversation.id } });
    });

    test("should allow workspace members to access shared conversations", async () => {
      // Add otherUser as member of testWorkspace
      await db.workspaceMember.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: otherUser.id,
          role: "DEVELOPER",
        },
      });

      const mockSession = createAuthenticatedSession(otherUser.id, otherUser.email, otherUser.name);

      const request = createGetRequest();
      const params = Promise.resolve({
        slug: testWorkspace.slug,
        shareId: sharedConversationId,
      });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe(sharedConversationId);

      // Clean up
      await db.workspaceMember.delete({
        where: {
          workspaceId_userId: {
            workspaceId: testWorkspace.id,
            userId: otherUser.id,
          },
        },
      });
    });
  });
});
