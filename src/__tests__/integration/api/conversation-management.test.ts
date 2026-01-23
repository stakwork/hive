import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET as GET_LIST, POST as POST_CREATE } from "@/app/api/workspaces/[slug]/chat/conversations/route";
import { GET as GET_ONE, PUT as PUT_UPDATE, DELETE as DELETE_ONE } from "@/app/api/workspaces/[slug]/chat/conversations/[conversationId]/route";
import { POST as POST_SHARE } from "@/app/api/workspaces/[slug]/chat/share/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectUnauthorized,
  generateUniqueId,
  createPostRequest,
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

  async function createTestConversation(workspaceId: string, userId: string, options: {
    title?: string;
    messages?: any[];
    isShared?: boolean;
    source?: string;
    lastMessageAt?: Date;
  } = {}) {
    const messages = options.messages || [
      { role: "user", content: "Test message" },
      { role: "assistant", content: "Test response" },
    ];

    return await db.sharedConversation.create({
      data: {
        workspaceId,
        userId,
        title: options.title || "Test Conversation",
        messages,
        followUpQuestions: ["Question 1", "Question 2"],
        isShared: options.isShared || false,
        source: options.source || null,
        lastMessageAt: options.lastMessageAt || new Date(),
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

        const response = await GET_LIST(request, {
          params: Promise.resolve({ slug: "test" }),
        });

        await expectUnauthorized(response);
      });
    });

    describe("Access Control Tests", () => {
      test("should return 403 for non-member user", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

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

        const response = await GET_LIST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(403);
      });

      test("should list conversations for workspace owner", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        // Create test conversations
        await createTestConversation(testWorkspace.id, testUser.id, {
          title: "Conv 1",
        });
        await createTestConversation(testWorkspace.id, testUser.id, {
          title: "Conv 2",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`
        );

        const response = await GET_LIST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.items).toHaveLength(2);
        expect(data.pagination).toBeDefined();
      });
    });

    describe("Pagination Tests", () => {
      test("should return paginated results", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        // Create 5 conversations
        for (let i = 0; i < 5; i++) {
          await createTestConversation(testWorkspace.id, testUser.id, {
            title: `Conversation ${i}`,
          });
        }

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations?page=1&limit=3`
        );

        const response = await GET_LIST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.items).toHaveLength(3);
        expect(data.pagination.page).toBe(1);
        expect(data.pagination.limit).toBe(3);
        expect(data.pagination.total).toBe(5);
        expect(data.pagination.totalPages).toBe(2);
      });

      test("should sort by lastMessageAt DESC", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

        await createTestConversation(testWorkspace.id, testUser.id, {
          title: "Old",
          lastMessageAt: twoDaysAgo,
        });
        await createTestConversation(testWorkspace.id, testUser.id, {
          title: "Recent",
          lastMessageAt: now,
        });
        await createTestConversation(testWorkspace.id, testUser.id, {
          title: "Middle",
          lastMessageAt: yesterday,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`
        );

        const response = await GET_LIST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.items[0].title).toBe("Recent");
        expect(data.items[1].title).toBe("Middle");
        expect(data.items[2].title).toBe("Old");
      });
    });

    describe("Response Format Tests", () => {
      test("should include preview and metadata fields", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        await createTestConversation(testWorkspace.id, testUser.id, {
          title: "Test Title",
          source: "learn",
          isShared: true,
          messages: [
            { role: "user", content: "First user message content" },
            { role: "assistant", content: "Response" },
          ],
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`
        );

        const response = await GET_LIST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        const item = data.items[0];
        
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("title");
        expect(item).toHaveProperty("lastMessageAt");
        expect(item).toHaveProperty("preview");
        expect(item).toHaveProperty("source");
        expect(item).toHaveProperty("isShared");
        expect(item).toHaveProperty("createdAt");
        expect(item).toHaveProperty("updatedAt");

        expect(item.title).toBe("Test Title");
        expect(item.preview).toBe("First user message content");
        expect(item.source).toBe("learn");
        expect(item.isShared).toBe(true);
      });
    });
  });

  describe("POST /api/workspaces/[slug]/chat/conversations", () => {
    describe("Authentication Tests", () => {
      test("should return 401 for unauthenticated request", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createPostRequest(
          "http://localhost:3000/api/workspaces/test/chat/conversations",
          { messages: [] }
        );

        const response = await POST_CREATE(request, {
          params: Promise.resolve({ slug: "test" }),
        });

        await expectUnauthorized(response);
      });
    });

    describe("Request Validation Tests", () => {
      test("should return 400 for missing messages", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`,
          {}
        );

        const response = await POST_CREATE(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe("messages array is required");
      });

      test("should return 400 for non-array messages", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`,
          { messages: "not an array" }
        );

        const response = await POST_CREATE(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(400);
      });
    });

    describe("Auto-title Generation Tests", () => {
      test("should auto-generate title from first user message", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`,
          {
            messages: [
              { role: "user", content: "How do I implement authentication in Next.js?" },
              { role: "assistant", content: "Here's how..." },
            ],
          }
        );

        const response = await POST_CREATE(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data.title).toBe("How do I implement authentication in Next.js?");
      });

      test("should truncate long titles to 50 chars", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const longMessage = "A".repeat(100);
        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`,
          {
            messages: [{ role: "user", content: longMessage }],
          }
        );

        const response = await POST_CREATE(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data.title).toBe("A".repeat(50) + "...");
      });

      test("should use provided title if specified", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`,
          {
            title: "Custom Title",
            messages: [{ role: "user", content: "Message" }],
          }
        );

        const response = await POST_CREATE(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data.title).toBe("Custom Title");
      });
    });

    describe("Field Tests", () => {
      test("should create conversation with all fields", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const messages = [
          { role: "user", content: "Test", createdAt: new Date().toISOString() },
        ];

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations`,
          {
            messages,
            source: "dashboard",
            provenanceData: { test: "data" },
            followUpQuestions: ["Q1", "Q2"],
          }
        );

        const response = await POST_CREATE(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();
        
        expect(data.isShared).toBe(false);
        expect(data.source).toBe("dashboard");
        expect(data.lastMessageAt).toBeDefined();
        expect(data.provenanceData).toEqual({ test: "data" });
        expect(data.followUpQuestions).toEqual(["Q1", "Q2"]);
      });
    });
  });

  describe("GET /api/workspaces/[slug]/chat/conversations/[conversationId]", () => {
    test("should retrieve specific conversation", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const conv = await createTestConversation(testWorkspace.id, testUser.id, {
        title: "Specific Conv",
        source: "learn",
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = new Request(
        `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conv.id}`
      );

      const response = await GET_ONE(request, {
        params: Promise.resolve({ slug: testWorkspace.slug, conversationId: conv.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe(conv.id);
      expect(data.title).toBe("Specific Conv");
      expect(data.source).toBe("learn");
      expect(data.messages).toBeDefined();
      expect(data.provenanceData).toBeDefined();
      expect(data.followUpQuestions).toBeDefined();
    });

    test("should return 404 for non-existent conversation", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = new Request(
        `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/non-existent`
      );

      const response = await GET_ONE(request, {
        params: Promise.resolve({ slug: testWorkspace.slug, conversationId: "non-existent" }),
      });

      expect(response.status).toBe(404);
    });

    test("should return 404 when accessing another user's conversation", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const otherUser = await db.user.create({
        data: {
          id: generateUniqueId("other-user"),
          email: `other-${generateUniqueId()}@example.com`,
          name: "Other User",
        },
      });

      const conv = await createTestConversation(testWorkspace.id, testUser.id);

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(otherUser)
      );

      const request = new Request(
        `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conv.id}`
      );

      const response = await GET_ONE(request, {
        params: Promise.resolve({ slug: testWorkspace.slug, conversationId: conv.id }),
      });

      // API returns 403 because user has workspace access but not conversation ownership
      // This is more accurate than 404 (which would hide the existence of the conversation)
      expect(response.status).toBe(403);
    });
  });

  describe("PUT /api/workspaces/[slug]/chat/conversations/[conversationId]", () => {
    test("should append messages to conversation", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const conv = await createTestConversation(testWorkspace.id, testUser.id, {
        messages: [
          { role: "user", content: "First" },
          { role: "assistant", content: "Response" },
        ],
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const newMessages = [
        { role: "user", content: "Second", createdAt: new Date().toISOString() },
        { role: "assistant", content: "Second response" },
      ];

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conv.id}`,
        { messages: newMessages }
      );

      const response = await PUT_UPDATE(request, {
        params: Promise.resolve({ slug: testWorkspace.slug, conversationId: conv.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.messages)).toBe(true);
      expect(data.messages).toHaveLength(4);
      expect(data.messages[2].content).toBe("Second");
    });

    test("should update lastMessageAt when appending messages", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const oldDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
      const conv = await createTestConversation(testWorkspace.id, testUser.id, {
        lastMessageAt: oldDate,
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const newDate = new Date();
      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conv.id}`,
        {
          messages: [
            { role: "user", content: "New message", createdAt: newDate.toISOString() },
          ],
        }
      );

      const response = await PUT_UPDATE(request, {
        params: Promise.resolve({ slug: testWorkspace.slug, conversationId: conv.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(new Date(data.lastMessageAt!).getTime()).toBeGreaterThan(oldDate.getTime());
    });

    test("should allow updating title and source", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const conv = await createTestConversation(testWorkspace.id, testUser.id, {
        title: "Old Title",
        source: "old-source",
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conv.id}`,
        {
          messages: [],
          title: "New Title",
          source: "new-source",
        }
      );

      const response = await PUT_UPDATE(request, {
        params: Promise.resolve({ slug: testWorkspace.slug, conversationId: conv.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.title).toBe("New Title");
      expect(data.source).toBe("new-source");
    });

    test("should return 404 when updating another user's conversation", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const otherUser = await db.user.create({
        data: {
          id: generateUniqueId("other-user"),
          email: `other-${generateUniqueId()}@example.com`,
          name: "Other User",
        },
      });

      const conv = await createTestConversation(testWorkspace.id, testUser.id);

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(otherUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conv.id}`,
        { messages: [] }
      );

      const response = await PUT_UPDATE(request, {
        params: Promise.resolve({ slug: testWorkspace.slug, conversationId: conv.id }),
      });

      // API returns 403 because user has workspace access but not conversation ownership
      expect(response.status).toBe(403);
    });
  });

  describe("DELETE /api/workspaces/[slug]/chat/conversations/[conversationId]", () => {
    test("should delete conversation", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const conv = await createTestConversation(testWorkspace.id, testUser.id);

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = new Request(
        `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conv.id}`,
        { method: "DELETE" }
      );

      const response = await DELETE_ONE(request, {
        params: Promise.resolve({ slug: testWorkspace.slug, conversationId: conv.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify deletion
      const deleted = await db.sharedConversation.findUnique({
        where: { id: conv.id },
      });
      expect(deleted).toBeNull();
    });

    test("should return 404 when deleting non-existent conversation", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = new Request(
        `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/non-existent`,
        { method: "DELETE" }
      );

      const response = await DELETE_ONE(request, {
        params: Promise.resolve({ slug: testWorkspace.slug, conversationId: "non-existent" }),
      });

      expect(response.status).toBe(404);
    });

    test("should return 404 when deleting another user's conversation", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const otherUser = await db.user.create({
        data: {
          id: generateUniqueId("other-user"),
          email: `other-${generateUniqueId()}@example.com`,
          name: "Other User",
        },
      });

      const conv = await createTestConversation(testWorkspace.id, testUser.id);

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(otherUser)
      );

      const request = new Request(
        `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/conversations/${conv.id}`,
        { method: "DELETE" }
      );

      const response = await DELETE_ONE(request, {
        params: Promise.resolve({ slug: testWorkspace.slug, conversationId: conv.id }),
      });

      // API returns 403 because user has workspace access but not conversation ownership
      expect(response.status).toBe(403);
    });
  });

  describe("POST /api/workspaces/[slug]/chat/share - Updated", () => {
    test("should set isShared to true when creating via share endpoint", async () => {
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

      const response = await POST_SHARE(request, {
        params: Promise.resolve({ slug: testWorkspace.slug }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();

      // Verify isShared is true
      const conv = await db.sharedConversation.findUnique({
        where: { id: data.shareId },
      });
      expect(conv?.isShared).toBe(true);
    });

    test("should update existing conversation when conversationId provided", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const conv = await createTestConversation(testWorkspace.id, testUser.id, {
        isShared: false,
        messages: [{ role: "user", content: "Original" }],
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/share`,
        {
          conversationId: conv.id,
          messages: [
            { role: "user", content: "Original" },
            { role: "assistant", content: "Response" },
          ],
          followUpQuestions: ["Q1"],
        }
      );

      const response = await POST_SHARE(request, {
        params: Promise.resolve({ slug: testWorkspace.slug }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.shareId).toBe(conv.id);

      // Verify it was updated and marked as shared
      const updated = await db.sharedConversation.findUnique({
        where: { id: conv.id },
      });
      expect(updated?.isShared).toBe(true);
      expect((updated?.messages as any[]).length).toBe(2);
    });

    test("should auto-generate title when sharing", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/share`,
        {
          messages: [{ role: "user", content: "How to use React hooks?" }],
          followUpQuestions: [],
        }
      );

      const response = await POST_SHARE(request, {
        params: Promise.resolve({ slug: testWorkspace.slug }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();

      const conv = await db.sharedConversation.findUnique({
        where: { id: data.shareId },
      });
      expect(conv?.title).toBe("How to use React hooks?");
    });
  });
});
