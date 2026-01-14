import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/w/[slug]/chat/share/route";
import { GET } from "@/app/api/w/[slug]/chat/shared/[shareId]/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  createPostRequest,
} from "@/__tests__/support/helpers";
import { SharedMessage } from "@/types/shared-conversation";

describe("Shared Conversation API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/w/[slug]/chat/share", () => {
    test("successfully creates a shared conversation", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const messages: SharedMessage[] = [
        { role: "user", content: "Hello, can you help me with testing?" },
        { role: "assistant", content: "Of course! I'd be happy to help with testing." },
      ];

      const request = createPostRequest(
        `http://localhost:3000/api/w/${workspace.slug}/chat/share`,
        {
          messages,
          provenanceData: { source: "agent-chat", timestamp: "2026-01-14T11:40:00Z" },
          followUpQuestions: ["How do I write unit tests?", "What about integration tests?"],
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(201);

      const data = await response.json();
      expect(data).toHaveProperty("shareId");
      expect(data).toHaveProperty("url");
      expect(data.url).toBe(`/w/${workspace.slug}/chat/shared/${data.shareId}`);

      // Verify in database
      const sharedConvo = await db.sharedConversation.findUnique({
        where: { id: data.shareId },
      });

      expect(sharedConvo).toBeDefined();
      expect(sharedConvo!.workspaceId).toBe(workspace.id);
      expect(sharedConvo!.userId).toBe(owner.id);
      expect(sharedConvo!.title).toBe("Hello, can you help me with testing?");
      expect(sharedConvo!.messages).toEqual(messages);
    });

    test("generates title from first user message with 100 char limit", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const longMessage = "A".repeat(150);
      const messages: SharedMessage[] = [
        { role: "user", content: longMessage },
        { role: "assistant", content: "Response" },
      ];

      const request = createPostRequest(
        `http://localhost:3000/api/w/${workspace.slug}/chat/share`,
        {
          messages,
          followUpQuestions: [],
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();

      const sharedConvo = await db.sharedConversation.findUnique({
        where: { id: data.shareId },
      });

      expect(sharedConvo!.title).toBe("A".repeat(100));
      expect(sharedConvo!.title!.length).toBe(100);
    });

    test("returns 401 for unauthenticated requests", async () => {
      const workspace = await createTestWorkspace({ ownerId: (await createTestUser()).id });

      getMockedSession().mockResolvedValue(null);

      const request = createPostRequest(
        `http://localhost:3000/api/w/${workspace.slug}/chat/share`,
        {
          messages: [{ role: "user", content: "Test" }],
          followUpQuestions: [],
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    test("returns 403 for non-workspace members", async () => {
      const owner = await createTestUser();
      const nonMember = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createPostRequest(
        `http://localhost:3000/api/w/${workspace.slug}/chat/share`,
        {
          messages: [{ role: "user", content: "Test" }],
          followUpQuestions: [],
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Access denied");
    });

    test("returns 400 for invalid messages array", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/w/${workspace.slug}/chat/share`,
        {
          messages: [],
          followUpQuestions: [],
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("messages");
    });

    test("returns 400 for missing followUpQuestions", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/w/${workspace.slug}/chat/share`,
        {
          messages: [{ role: "user", content: "Test" }],
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("followUpQuestions");
    });

    test("returns 400 for invalid message structure", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/w/${workspace.slug}/chat/share`,
        {
          messages: [{ role: "invalid" }],
          followUpQuestions: [],
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(400);
    });

    test("handles optional provenanceData", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/w/${workspace.slug}/chat/share`,
        {
          messages: [{ role: "user", content: "Test" }],
          followUpQuestions: [],
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();

      const sharedConvo = await db.sharedConversation.findUnique({
        where: { id: data.shareId },
      });

      expect(sharedConvo!.provenanceData).toBeNull();
    });
  });

  describe("GET /api/w/[slug]/chat/shared/[shareId]", () => {
    test("successfully retrieves a shared conversation", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      const messages: SharedMessage[] = [
        { role: "user", content: "Hello!" },
        { role: "assistant", content: "Hi there!" },
      ];

      const sharedConvo = await db.sharedConversation.create({
        data: {
          workspaceId: workspace.id,
          userId: owner.id,
          title: "Hello!",
          messages: messages as any,
          provenanceData: { source: "test" },
          followUpQuestions: ["Question 1"],
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = new Request(
        `http://localhost:3000/api/w/${workspace.slug}/chat/shared/${sharedConvo.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, shareId: sharedConvo.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.id).toBe(sharedConvo.id);
      expect(data.workspaceId).toBe(workspace.id);
      expect(data.userId).toBe(owner.id);
      expect(data.title).toBe("Hello!");
      expect(data.messages).toEqual(messages);
      expect(data.followUpQuestions).toEqual(["Question 1"]);
    });

    test("allows workspace members to access shared conversation", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await createTestMembership({
        workspaceId: workspace.id,
        userId: member.id,
        role: "DEVELOPER",
      });

      const sharedConvo = await db.sharedConversation.create({
        data: {
          workspaceId: workspace.id,
          userId: owner.id,
          title: "Test",
          messages: [{ role: "user", content: "Test" }] as any,
          followUpQuestions: [],
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(member));

      const request = new Request(
        `http://localhost:3000/api/w/${workspace.slug}/chat/shared/${sharedConvo.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, shareId: sharedConvo.id }),
      });

      expect(response.status).toBe(200);
    });

    test("returns 401 for unauthenticated requests", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      const sharedConvo = await db.sharedConversation.create({
        data: {
          workspaceId: workspace.id,
          userId: owner.id,
          title: "Test",
          messages: [{ role: "user", content: "Test" }] as any,
          followUpQuestions: [],
        },
      });

      getMockedSession().mockResolvedValue(null);

      const request = new Request(
        `http://localhost:3000/api/w/${workspace.slug}/chat/shared/${sharedConvo.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, shareId: sharedConvo.id }),
      });

      expect(response.status).toBe(401);
    });

    test("returns 403 for non-workspace members", async () => {
      const owner = await createTestUser();
      const nonMember = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      const sharedConvo = await db.sharedConversation.create({
        data: {
          workspaceId: workspace.id,
          userId: owner.id,
          title: "Test",
          messages: [{ role: "user", content: "Test" }] as any,
          followUpQuestions: [],
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = new Request(
        `http://localhost:3000/api/w/${workspace.slug}/chat/shared/${sharedConvo.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, shareId: sharedConvo.id }),
      });

      expect(response.status).toBe(403);
    });

    test("returns 404 for non-existent shareId", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = new Request(
        `http://localhost:3000/api/w/${workspace.slug}/chat/shared/nonexistent`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, shareId: "nonexistent" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("not found");
    });

    test("returns 404 when shareId belongs to different workspace", async () => {
      const owner1 = await createTestUser();
      const owner2 = await createTestUser();
      const workspace1 = await createTestWorkspace({ ownerId: owner1.id });
      const workspace2 = await createTestWorkspace({ ownerId: owner2.id });

      const sharedConvo = await db.sharedConversation.create({
        data: {
          workspaceId: workspace2.id,
          userId: owner2.id,
          title: "Test",
          messages: [{ role: "user", content: "Test" }] as any,
          followUpQuestions: [],
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner1));

      const request = new Request(
        `http://localhost:3000/api/w/${workspace1.slug}/chat/shared/${sharedConvo.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace1.slug, shareId: sharedConvo.id }),
      });

      expect(response.status).toBe(404);
    });
  });
});
