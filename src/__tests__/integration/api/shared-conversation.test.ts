import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/workspaces/[slug]/chat/share/route";
import { GET } from "@/app/api/workspaces/[slug]/chat/shared/[shareId]/route";
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

describe("SharedConversation API Integration Tests", () => {
  // Helper to create test data
  async function createTestUserWithWorkspace() {
    return await db.$transaction(async (tx) => {
      // Create test user
      const testUser = await tx.user.create({
        data: {
          id: generateUniqueId("test-user"),
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace
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

  async function createTestUserWithMembership() {
    return await db.$transaction(async (tx) => {
      // Create owner user
      const ownerUser = await tx.user.create({
        data: {
          id: generateUniqueId("owner-user"),
          email: `owner-${generateUniqueId()}@example.com`,
          name: "Owner User",
        },
      });

      // Create member user
      const memberUser = await tx.user.create({
        data: {
          id: generateUniqueId("member-user"),
          email: `member-${generateUniqueId()}@example.com`,
          name: "Member User",
        },
      });

      // Create workspace
      const testWorkspace = await tx.workspace.create({
        data: {
          id: generateUniqueId("workspace"),
          name: "Test Workspace",
          slug: generateUniqueId("test-workspace"),
          description: "Test workspace description",
          ownerId: ownerUser.id,
        },
      });

      // Add member to workspace
      await tx.workspaceMember.create({
        data: {
          id: generateUniqueId("member"),
          workspaceId: testWorkspace.id,
          userId: memberUser.id,
          role: "DEVELOPER",
        },
      });

      return { ownerUser, memberUser, testWorkspace };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("POST /api/workspaces/[slug]/chat/share", () => {
    describe("Authentication Tests", () => {
      test("should return 401 for unauthenticated request", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createPostRequest(
          "http://localhost:3000/api/workspaces/test/chat/share",
          {
            messages: [],
            followUpQuestions: [],
          }
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: "test" }),
        });

        await expectUnauthorized(response);
      });

      test("should return 401 for invalid user session", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id
        });

        const request = createPostRequest(
          "http://localhost:3000/api/workspaces/test/chat/share",
          {
            messages: [],
            followUpQuestions: [],
          }
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: "test" }),
        });

        expect(response.status).toBe(401);
      });
    });

    describe("Access Control Tests", () => {
      test("should return 403 for non-member user", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        // Create a different user who is not a member
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

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/share`,
          {
            messages: [{ role: "user", content: "Test message" }],
            followUpQuestions: ["Question 1"],
          }
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(403);
        const data = await response.json();
        expect(data.error).toBe("Workspace not found or access denied");
      });

      test("should allow workspace owner to create shared conversation", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const messages = [
          { role: "user", content: "Test message" },
          { role: "assistant", content: "Test response" },
        ];
        const followUpQuestions = ["Question 1", "Question 2"];

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/share`,
          {
            messages,
            followUpQuestions,
          }
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data).toHaveProperty("shareId");
        expect(data).toHaveProperty("url");
        expect(data.url).toBe(`/w/${testWorkspace.slug}/chat/shared/${data.shareId}`);
      });

      test("should allow workspace member to create shared conversation", async () => {
        const { memberUser, testWorkspace } = await createTestUserWithMembership();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(memberUser)
        );

        const messages = [{ role: "user", content: "Member message" }];
        const followUpQuestions = ["Member question"];

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/share`,
          {
            messages,
            followUpQuestions,
          }
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);
      });
    });

    describe("Request Validation Tests", () => {
      test("should return 400 for missing messages field", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/share`,
          {
            followUpQuestions: ["Question 1"],
          }
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe("messages field is required");
      });

      test("should return 400 for missing followUpQuestions field", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/share`,
          {
            messages: [{ role: "user", content: "Test" }],
          }
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe("followUpQuestions field is required");
      });

      test("should create conversation with optional fields", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const messages = [{ role: "user", content: "Test message" }];
        const provenanceData = {
          concepts: [{ id: "1", name: "Test Concept" }],
          files: [],
          codeEntities: [],
        };
        const followUpQuestions = ["Question 1"];

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/share`,
          {
            title: "Test Conversation Title",
            messages,
            provenanceData,
            followUpQuestions,
          }
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data).toHaveProperty("shareId");

        // Verify data was stored correctly
        const stored = await db.sharedConversation.findUnique({
          where: { id: data.shareId },
        });
        expect(stored).toBeTruthy();
        expect(stored?.title).toBe("Test Conversation Title");
        expect(stored?.provenanceData).toEqual(provenanceData);
      });
    });
  });

  describe("GET /api/workspaces/[slug]/chat/shared/[shareId]", () => {
    describe("Authentication Tests", () => {
      test("should return 401 for unauthenticated request", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = new Request(
          "http://localhost:3000/api/workspaces/test/chat/shared/test-id"
        );

        const response = await GET(request, {
          params: Promise.resolve({ slug: "test", shareId: "test-id" }),
        });

        await expectUnauthorized(response);
      });
    });

    describe("Access Control Tests", () => {
      test("should return 403 for non-workspace member", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        // Create shared conversation
        const sharedConv = await db.sharedConversation.create({
          data: {
            workspaceId: testWorkspace.id,
            userId: testUser.id,
            messages: [{ role: "user", content: "Test" }],
            followUpQuestions: ["Q1"],
          },
        });

        // Create a different user who is not a member
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
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/shared/${sharedConv.id}`
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            shareId: sharedConv.id,
          }),
        });

        expect(response.status).toBe(403);
        const data = await response.json();
        expect(data.error).toContain("must be a workspace member");
      });

      test("should allow workspace owner to view shared conversation", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const messages = [
          { role: "user", content: "Test message" },
          { role: "assistant", content: "Test response" },
        ];
        const followUpQuestions = ["Q1", "Q2"];

        const sharedConv = await db.sharedConversation.create({
          data: {
            workspaceId: testWorkspace.id,
            userId: testUser.id,
            title: "Test Title",
            messages,
            followUpQuestions,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/shared/${sharedConv.id}`
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            shareId: sharedConv.id,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.id).toBe(sharedConv.id);
        expect(data.title).toBe("Test Title");
        expect(data.messages).toEqual(messages);
        expect(data.followUpQuestions).toEqual(followUpQuestions);
      });

      test("should allow workspace member to view shared conversation", async () => {
        const { ownerUser, memberUser, testWorkspace } =
          await createTestUserWithMembership();

        const sharedConv = await db.sharedConversation.create({
          data: {
            workspaceId: testWorkspace.id,
            userId: ownerUser.id,
            messages: [{ role: "user", content: "Owner message" }],
            followUpQuestions: ["Q1"],
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(memberUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/shared/${sharedConv.id}`
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            shareId: sharedConv.id,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.id).toBe(sharedConv.id);
      });
    });

    describe("Resource Not Found Tests", () => {
      test("should return 404 for non-existent workspace", async () => {
        const testUser = await db.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `test-${generateUniqueId()}@example.com`,
            name: "Test User",
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          "http://localhost:3000/api/workspaces/non-existent/chat/shared/test-id"
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: "non-existent",
            shareId: "test-id",
          }),
        });

        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe("Workspace not found");
      });

      test("should return 404 for non-existent shared conversation", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/shared/non-existent-id`
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            shareId: "non-existent-id",
          }),
        });

        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe("Shared conversation not found");
      });

      test("should return 403 when shared conversation belongs to different workspace", async () => {
        // Create two workspaces
        const workspace1 = await db.workspace.create({
          data: {
            name: "Workspace 1",
            slug: generateUniqueId("workspace1"),
            ownerId: (
              await db.user.create({
                data: {
                  id: generateUniqueId("user1"),
                  email: `user1-${generateUniqueId()}@example.com`,
                  name: "User 1",
                },
              })
            ).id,
          },
        });

        const workspace2Owner = await db.user.create({
          data: {
            id: generateUniqueId("user2"),
            email: `user2-${generateUniqueId()}@example.com`,
            name: "User 2",
          },
        });

        const workspace2 = await db.workspace.create({
          data: {
            name: "Workspace 2",
            slug: generateUniqueId("workspace2"),
            ownerId: workspace2Owner.id,
          },
        });

        // Create shared conversation in workspace1
        const sharedConv = await db.sharedConversation.create({
          data: {
            workspaceId: workspace1.id,
            userId: workspace1.ownerId,
            messages: [{ role: "user", content: "Test" }],
            followUpQuestions: ["Q1"],
          },
        });

        // Try to access it via workspace2
        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(workspace2Owner)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${workspace2.slug}/chat/shared/${sharedConv.id}`
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: workspace2.slug,
            shareId: sharedConv.id,
          }),
        });

        expect(response.status).toBe(404);
      });
    });

    describe("Data Integrity Tests", () => {
      test("should return all fields including nullable ones", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const provenanceData = {
          concepts: [{ id: "1", name: "Test" }],
          files: [],
          codeEntities: [],
        };

        const sharedConv = await db.sharedConversation.create({
          data: {
            workspaceId: testWorkspace.id,
            userId: testUser.id,
            title: "Test Title",
            messages: [{ role: "user", content: "Message" }],
            provenanceData,
            followUpQuestions: ["Q1"],
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/shared/${sharedConv.id}`
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            shareId: sharedConv.id,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();

        expect(data).toHaveProperty("id");
        expect(data).toHaveProperty("workspaceId");
        expect(data).toHaveProperty("userId");
        expect(data).toHaveProperty("title");
        expect(data).toHaveProperty("messages");
        expect(data).toHaveProperty("provenanceData");
        expect(data).toHaveProperty("followUpQuestions");
        expect(data).toHaveProperty("createdAt");
        expect(data).toHaveProperty("updatedAt");

        expect(data.provenanceData).toEqual(provenanceData);
      });

      test("should handle null provenanceData correctly", async () => {
        const { testUser, testWorkspace } = await createTestUserWithWorkspace();

        const sharedConv = await db.sharedConversation.create({
          data: {
            workspaceId: testWorkspace.id,
            userId: testUser.id,
            messages: [{ role: "user", content: "Message" }],
            provenanceData: null,
            followUpQuestions: ["Q1"],
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = new Request(
          `http://localhost:3000/api/workspaces/${testWorkspace.slug}/chat/shared/${sharedConv.id}`
        );

        const response = await GET(request, {
          params: Promise.resolve({
            slug: testWorkspace.slug,
            shareId: sharedConv.id,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.provenanceData).toBeNull();
      });
    });
  });
});
