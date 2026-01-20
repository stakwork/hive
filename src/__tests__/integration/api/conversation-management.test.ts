import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET as GetConversations, POST as CreateConversation } from "@/app/api/workspaces/[slug]/chat/conversations/route";
import {
  GET as GetConversation,
  PUT as UpdateConversation,
  DELETE as DeleteConversation,
} from "@/app/api/workspaces/[slug]/chat/conversations/[conversationId]/route";
import { POST as ShareConversation } from "@/app/api/workspaces/[slug]/chat/share/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectUnauthorized,
  generateUniqueId,
  createPostRequest,
  createPutRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";

// Mock auth functions
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

describe("Conversation Management API Integration Tests", () => {
  // Helper to create test data
  async function createTestUserWithWorkspace() {
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

      return { testUser, testWorkspace };
    });
  }

  async function createConversation(workspaceId: string, userId: string, source = "dashboard") {
    return await db.sharedConversation.create({
      data: {
        workspaceId,
        userId,
        title: "Test Conversation",
        messages: [
          { role: "user", content: "Hello, this is a test message" },
          { role: "assistant", content: "This is a test response" },
        ],
        followUpQuestions: ["What is next?"],
        source,
        isShared: false,
      },
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces/[slug]/chat/conversations", () => {
    describe("Authentication Tests", () => {
      test("should return 401 for unauthenticated request", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = new Request(
          "http://localhost:3000/api/workspaces/test/chat/conversations"
        );

        const response = await GetConversations(request, {
          params: Promise.resolve({ slug: "test" }),
        });

        await expectUnauthorized(response);
      });
    });

    describe("Access Control Tests", () => {
      test("should return 403 for non-member user", async () => {
        const { testWorkspace } = await createTestUserWithWorkspace();

        const nonMemberUser = await db.user.create({
          data: {
            id: generateUniqueId("non-member"),
            email: `nonmember-${generateUniqueId()}@example.com`,
            name: "Non Member",
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(nonMemberUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`
        );

        const response = await GetConversations(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(403);
      });

      test("should list conversations for workspace owner", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        // Create multiple conversations
        await createConversation(testWorkspace.id, testUser.id, "dashboard");
        await createConversation(testWorkspace.id, testUser.id, "learn");

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`
        );

        const response = await GetConversations(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.conversations).toHaveLength(2);
      });
    });

    describe("Query Parameters Tests", () => {
      test("should filter conversations by source", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        await createConversation(testWorkspace.id, testUser.id, "dashboard");
        await createConversation(testWorkspace.id, testUser.id, "learn");

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations?source=dashboard`
        );

        const response = await GetConversations(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.conversations).toHaveLength(1);
        expect(data.conversations[0].source).toBe("dashboard");
      });

      test("should limit number of conversations returned", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        // Create 5 conversations
        for (let i = 0; i < 5; i++) {
          await createConversation(testWorkspace.id, testUser.id);
        }

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations?limit=3`
        );

        const response = await GetConversations(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.conversations).toHaveLength(3);
      });

      test("should sort conversations by lastMessageAt DESC", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const conv1 = await createConversation(testWorkspace.id, testUser.id);
        await new Promise(resolve => setTimeout(resolve, 100));
        const conv2 = await createConversation(testWorkspace.id, testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`
        );

        const response = await GetConversations(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.conversations[0].id).toBe(conv2.id);
        expect(data.conversations[1].id).toBe(conv1.id);
      });
    });

    describe("Response Format Tests", () => {
      test("should return correct ConversationListItem format", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        await createConversation(testWorkspace.id, testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`
        );

        const response = await GetConversations(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.conversations[0]).toHaveProperty("id");
        expect(data.conversations[0]).toHaveProperty("title");
        expect(data.conversations[0]).toHaveProperty("lastMessageAt");
        expect(data.conversations[0]).toHaveProperty("source");
        expect(data.conversations[0]).toHaveProperty("preview");
        expect(data.conversations[0]).toHaveProperty("messageCount");
        expect(data.conversations[0].messageCount).toBe(2);
        expect(data.conversations[0].preview).toBe("Hello, this is a test message");
      });
    });
  });

  describe("POST /api/workspaces/[slug]/chat/conversations", () => {
    describe("Authentication Tests", () => {
      test("should return 401 for unauthenticated request", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createPostRequest(
          "http://localhost:3000/api/workspaces/test/chat/conversations",
          {
            messages: [],
            followUpQuestions: [],
            source: "dashboard",
          }
        );

        const response = await CreateConversation(request, {
          params: Promise.resolve({ slug: "test" }),
        });

        await expectUnauthorized(response);
      });
    });

    describe("Validation Tests", () => {
      test("should return 400 for missing messages field", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`,
          {
            followUpQuestions: [],
            source: "dashboard",
          }
        );

        const response = await CreateConversation(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe("messages field is required");
      });

      test("should return 400 for missing source field", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`,
          {
            messages: [{ role: "user", content: "Test" }],
            followUpQuestions: [],
          }
        );

        const response = await CreateConversation(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe("source field is required");
      });
    });

    describe("Create Conversation Tests", () => {
      test("should create conversation with auto-generated title", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`,
          {
            messages: [{ role: "user", content: "This is a test message for auto-generated title" }],
            followUpQuestions: ["Q1"],
            source: "dashboard",
          }
        );

        const response = await CreateConversation(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data.title).toBe("This is a test message for auto-generated title");
        expect(data.source).toBe("dashboard");
      });

      test("should create conversation with custom title", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`,
          {
            messages: [{ role: "user", content: "Test message" }],
            followUpQuestions: ["Q1"],
            source: "dashboard",
            title: "Custom Title",
          }
        );

        const response = await CreateConversation(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data.title).toBe("Custom Title");
      });

      test("should create conversation with isShared=false by default", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`,
          {
            messages: [{ role: "user", content: "Test" }],
            followUpQuestions: ["Q1"],
            source: "dashboard",
          }
        );

        const response = await CreateConversation(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();

        const stored = await db.sharedConversation.findUnique({
          where: { id: data.id },
        });
        expect(stored?.isShared).toBe(false);
      });
    });
  });

  describe("GET /api/workspaces/[slug]/chat/conversations/[conversationId]", () => {
    describe("Authentication Tests", () => {
      test("should return 401 for unauthenticated request", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = new Request(
          "http://localhost:3000/api/workspaces/test/chat/conversations/test-id"
        );

        const response = await GetConversation(request, {
          params: Promise.resolve({ slug: "test", conversationId: "test-id" }),
        });

        await expectUnauthorized(response);
      });
    });

    describe("Access Control Tests", () => {
      test("should return 404 for conversation not owned by user", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const otherUser = await db.user.create({
          data: {
            id: generateUniqueId("other-user"),
            email: `other-${generateUniqueId()}@example.com`,
            name: "Other User",
          },
        });

        const conversation = await createConversation(testWorkspace.id, otherUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conversation.id}`
        );

        const response = await GetConversation(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            conversationId: conversation.id,
          }),
        });

        expect(response.status).toBe(404);
      });

      test("should retrieve conversation owned by user", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const conversation = await createConversation(testWorkspace.id, testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conversation.id}`
        );

        const response = await GetConversation(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            conversationId: conversation.id,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.id).toBe(conversation.id);
        expect(data.title).toBe("Test Conversation");
        expect(data.messages).toHaveLength(2);
        expect(data.isShared).toBe(false);
      });
    });
  });

  describe("PUT /api/workspaces/[slug]/chat/conversations/[conversationId]", () => {
    describe("Authentication Tests", () => {
      test("should return 401 for unauthenticated request", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createPutRequest(
          "http://localhost:3000/api/workspaces/test/chat/conversations/test-id",
          { title: "Updated Title" }
        );

        const response = await UpdateConversation(request, {
          params: Promise.resolve({ slug: "test", conversationId: "test-id" }),
        });

        await expectUnauthorized(response);
      });
    });

    describe("Update Conversation Tests", () => {
      test("should append messages without replacing existing ones", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const conversation = await createConversation(testWorkspace.id, testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const newMessages = [
          { role: "user", content: "New message" },
          { role: "assistant", content: "New response" },
        ];

        const request = createPutRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conversation.id}`,
          { messages: newMessages }
        );

        const response = await UpdateConversation(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            conversationId: conversation.id,
          }),
        });

        expect(response.status).toBe(200);

        // Verify messages were appended
        const updated = await db.sharedConversation.findUnique({
          where: { id: conversation.id },
        });
        expect(Array.isArray(updated?.messages) && updated.messages).toHaveLength(4);
      });

      test("should update lastMessageAt when messages are appended", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const conversation = await createConversation(testWorkspace.id, testUser.id);
        const originalLastMessageAt = conversation.lastMessageAt;

        await new Promise(resolve => setTimeout(resolve, 100));

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPutRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conversation.id}`,
          { messages: [{ role: "user", content: "New message" }] }
        );

        const response = await UpdateConversation(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            conversationId: conversation.id,
          }),
        });

        expect(response.status).toBe(200);

        const updated = await db.sharedConversation.findUnique({
          where: { id: conversation.id },
        });
        expect(updated?.lastMessageAt.getTime()).toBeGreaterThan(originalLastMessageAt.getTime());
      });

      test("should update title", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const conversation = await createConversation(testWorkspace.id, testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPutRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conversation.id}`,
          { title: "Updated Title" }
        );

        const response = await UpdateConversation(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            conversationId: conversation.id,
          }),
        });

        expect(response.status).toBe(200);

        const updated = await db.sharedConversation.findUnique({
          where: { id: conversation.id },
        });
        expect(updated?.title).toBe("Updated Title");
      });

      test("should update followUpQuestions", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const conversation = await createConversation(testWorkspace.id, testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const newQuestions = ["Question 1", "Question 2", "Question 3"];

        const request = createPutRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conversation.id}`,
          { followUpQuestions: newQuestions }
        );

        const response = await UpdateConversation(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            conversationId: conversation.id,
          }),
        });

        expect(response.status).toBe(200);

        const updated = await db.sharedConversation.findUnique({
          where: { id: conversation.id },
        });
        expect(updated?.followUpQuestions).toEqual(newQuestions);
      });
    });
  });

  describe("DELETE /api/workspaces/[slug]/chat/conversations/[conversationId]", () => {
    describe("Authentication Tests", () => {
      test("should return 401 for unauthenticated request", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = new Request(
          "http://localhost:3000/api/workspaces/test/chat/conversations/test-id",
          { method: "DELETE" }
        );

        const response = await DeleteConversation(request, {
          params: Promise.resolve({ slug: "test", conversationId: "test-id" }),
        });

        await expectUnauthorized(response);
      });
    });

    describe("Delete Conversation Tests", () => {
      test("should delete conversation owned by user", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const conversation = await createConversation(testWorkspace.id, testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conversation.id}`,
          { method: "DELETE" }
        );

        const response = await DeleteConversation(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            conversationId: conversation.id,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);

        // Verify deletion
        const deleted = await db.sharedConversation.findUnique({
          where: { id: conversation.id },
        });
        expect(deleted).toBeNull();
      });

      test("should return 404 for conversation not owned by user", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const otherUser = await db.user.create({
          data: {
            id: generateUniqueId("other-user"),
            email: `other-${generateUniqueId()}@example.com`,
            name: "Other User",
          },
        });

        const conversation = await createConversation(testWorkspace.id, otherUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conversation.id}`,
          { method: "DELETE" }
        );

        const response = await DeleteConversation(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            conversationId: conversation.id,
          }),
        });

        expect(response.status).toBe(404);
      });
    });
  });

  describe("Share Endpoint Integration", () => {
    describe("Link Existing Conversation Tests", () => {
      test("should link existing conversation and set isShared=true", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const conversation = await createConversation(testWorkspace.id, testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/share`,
          {
            conversationId: conversation.id,
          }
        );

        const response = await ShareConversation(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.shareId).toBe(conversation.id);

        // Verify isShared was set to true
        const updated = await db.sharedConversation.findUnique({
          where: { id: conversation.id },
        });
        expect(updated?.isShared).toBe(true);
      });

      test("should return 404 for non-existent conversationId", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/share`,
          {
            conversationId: "non-existent-id",
          }
        );

        const response = await ShareConversation(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(404);
      });

      test("should create new shared conversation when conversationId not provided", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/share`,
          {
            messages: [{ role: "user", content: "Test" }],
            followUpQuestions: ["Q1"],
          }
        );

        const response = await ShareConversation(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();

        // Verify new conversation was created with isShared=true
        const created = await db.sharedConversation.findUnique({
          where: { id: data.shareId },
        });
        expect(created?.isShared).toBe(true);
        expect(created?.source).toBe("dashboard");
      });
    });
  });
});
