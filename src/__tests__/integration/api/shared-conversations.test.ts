import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST as ShareConversationPOST } from "@/app/api/workspaces/[slug]/conversations/share/route";
import { GET as GetSharedConversationGET } from "@/app/api/workspaces/[slug]/shared/conversations/[shareCode]/route";
import { db } from "@/lib/db";
import {
  createPostRequest,
  createGetRequest,
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectForbidden,
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  generateUniqueId,
  expectNotFound,
  getMockedSession,
} from "@/__tests__/support/helpers";

describe("Shared Conversations API Integration Tests", () => {
  // Track created resources for cleanup
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdSharedConversationIds: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Cleanup created resources in reverse order of dependencies
    if (createdSharedConversationIds.length > 0) {
      await db.sharedConversation.deleteMany({
        where: { id: { in: createdSharedConversationIds } },
      });
      createdSharedConversationIds.length = 0;
    }

    if (createdWorkspaceIds.length > 0) {
      await db.workspaceMember.deleteMany({
        where: { workspaceId: { in: createdWorkspaceIds } },
      });
      await db.workspace.deleteMany({
        where: { id: { in: createdWorkspaceIds } },
      });
      createdWorkspaceIds.length = 0;
    }

    if (createdUserIds.length > 0) {
      await db.session.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await db.account.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await db.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      createdUserIds.length = 0;
    }
  });

  /**
   * Helper to create test fixtures
   */
  async function createTestFixtures(options?: {
    userRole?: "OWNER" | "ADMIN" | "DEVELOPER" | "VIEWER";
    includeSecondUser?: boolean;
  }) {
    const { userRole = "OWNER", includeSecondUser = false } = options || {};

    // Create owner user
    const ownerId = generateUniqueId();
    const ownerEmail = `owner-${ownerId}@test.com`;
    const owner = await db.user.create({
      data: {
        id: ownerId,
        name: "Test Owner",
        email: ownerEmail,
      },
    });
    createdUserIds.push(ownerId);

    // Create workspace
    const workspaceSlug = `test-workspace-${generateUniqueId()}`;
    const workspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: workspaceSlug,
        ownerId: owner.id,
      },
    });
    createdWorkspaceIds.push(workspace.id);

    // Create session object for owner (but don't mock yet - tests will mock as needed)
    const ownerSession = createAuthenticatedSession(owner);

    let memberUser = null;
    let memberSession = null;

    if (includeSecondUser) {
      // Create member user
      const memberId = generateUniqueId();
      const memberEmail = `member-${memberId}@test.com`;
      memberUser = await db.user.create({
        data: {
          id: memberId,
          name: "Test Member",
          email: memberEmail,
        },
      });
      createdUserIds.push(memberId);

      // Add member to workspace
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: memberUser.id,
          role: userRole,
        },
      });

      // Create session object for member (but don't mock yet)
      memberSession = createAuthenticatedSession(memberUser);
    }

    return {
      owner,
      ownerSession,
      memberUser,
      memberSession,
      workspace,
      workspaceSlug,
    };
  }

  describe("POST /api/workspaces/[slug]/conversations/share", () => {
    test("should create shared conversation with title", async () => {
      const { owner, ownerSession, workspace, workspaceSlug } = await createTestFixtures();

      // Ensure session is mocked before API call
      getMockedSession().mockResolvedValue(ownerSession);

      const messages = [
        {
          role: "user",
          content: "Hello, this is a test message",
          timestamp: new Date().toISOString(),
        },
        {
          role: "assistant",
          content: "This is a response",
          timestamp: new Date().toISOString(),
        },
      ];

      const body = {
        messages,
        title: "Test Conversation",
      };

      const request = createPostRequest("/api/workspaces/test/conversations/share", body);
      const response = await ShareConversationPOST(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });

      expectSuccess(response, 201);
      const data = await response.json();

      expect(data).toHaveProperty("shareCode");
      expect(data).toHaveProperty("shareUrl");
      expect(data.shareCode).toHaveLength(8);
      expect(data.shareCode).toMatch(/^[a-zA-Z0-9]+$/);
      expect(data.shareUrl).toBe(`/w/${workspaceSlug}/shared/conversations/${data.shareCode}`);

      // Verify it was created in database
      const created = await db.sharedConversation.findUnique({
        where: { shareCode: data.shareCode },
      });
      expect(created).not.toBeNull();
      expect(created?.title).toBe("Test Conversation");
      expect(created?.workspaceId).toBe(workspace.id);
      expect(created?.createdById).toBe(owner.id);
      expect(created?.messages).toEqual(messages);

      if (created) {
        createdSharedConversationIds.push(created.id);
      }
    });

    test("should create shared conversation without title", async () => {
      const { owner, ownerSession, workspace, workspaceSlug } = await createTestFixtures();

      // Ensure session is mocked before API call
      getMockedSession().mockResolvedValue(ownerSession);

      const messages = [
        {
          role: "user",
          content: "Test message without title",
          timestamp: new Date().toISOString(),
        },
      ];

      const body = { messages };

      const request = createPostRequest("/api/workspaces/test/conversations/share", body);
      const response = await ShareConversationPOST(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });

      expectSuccess(response, 201);
      const data = await response.json();

      expect(data).toHaveProperty("shareCode");
      expect(data.shareCode).toHaveLength(8);

      // Verify it was created with null title
      const created = await db.sharedConversation.findUnique({
        where: { shareCode: data.shareCode },
      });
      expect(created?.title).toBeNull();

      if (created) {
        createdSharedConversationIds.push(created.id);
      }
    });

    test("should handle messages with images and toolCalls", async () => {
      const { owner, ownerSession, workspace, workspaceSlug } = await createTestFixtures();

      // Ensure session is mocked before API call
      getMockedSession().mockResolvedValue(ownerSession);

      const messages = [
        {
          role: "user",
          content: "Check this image",
          timestamp: new Date().toISOString(),
          imageData: ["https://example.com/image1.jpg"],
        },
        {
          role: "assistant",
          content: "I see the image",
          timestamp: new Date().toISOString(),
          toolCalls: [
            {
              id: "tool-1",
              name: "image_analysis",
              arguments: { url: "https://example.com/image1.jpg" },
            },
          ],
        },
      ];

      const body = {
        messages,
        title: "Image Analysis Conversation",
      };

      const request = createPostRequest("/api/workspaces/test/conversations/share", body);
      const response = await ShareConversationPOST(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });

      expectSuccess(response, 201);
      const data = await response.json();

      // Verify messages were serialized correctly
      const created = await db.sharedConversation.findUnique({
        where: { shareCode: data.shareCode },
      });
      expect(created?.messages).toEqual(messages);

      if (created) {
        createdSharedConversationIds.push(created.id);
      }
    });

    test("should return 401 for unauthenticated requests", async () => {
      // Mock unauthenticated session FIRST
      getMockedSession().mockResolvedValue(null);
      
      // Create fixtures (this will still call getMockedSession in createTestFixtures but we override it next)
      const { workspaceSlug } = await createTestFixtures();
      
      // Re-mock to ensure no session
      getMockedSession().mockResolvedValue(null);

      const body = {
        messages: [{ role: "user", content: "test" }],
      };

      const request = createPostRequest("/api/workspaces/test/conversations/share", body);
      const response = await ShareConversationPOST(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });

      expectUnauthorized(response);
    });

    test("should return 400 for empty messages array", async () => {
      const { ownerSession, workspaceSlug } = await createTestFixtures();

      // Ensure session is mocked before API call
      getMockedSession().mockResolvedValue(ownerSession);

      const body = {
        messages: [],
      };

      const request = createPostRequest("/api/workspaces/test/conversations/share", body);
      const response = await ShareConversationPOST(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });

      expectError(response, 400);
      const data = await response.json();
      expect(data.error).toContain("Messages array is required");
    });

    test("should return 400 for missing messages field", async () => {
      const { ownerSession, workspaceSlug } = await createTestFixtures();

      // Ensure session is mocked before API call
      getMockedSession().mockResolvedValue(ownerSession);

      const body = {
        title: "Test",
      };

      const request = createPostRequest("/api/workspaces/test/conversations/share", body);
      const response = await ShareConversationPOST(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });

      expectError(response, 400);
    });

    test("should return 403 for non-workspace member", async () => {
      const { workspaceSlug } = await createTestFixtures();

      // Create a different user not in the workspace
      const nonMemberId = generateUniqueId();
      const nonMember = await db.user.create({
        data: {
          id: nonMemberId,
          name: "Non Member",
          email: `non-member-${nonMemberId}@test.com`,
        },
      });
      createdUserIds.push(nonMemberId);

      // Mock session for non-member
      const nonMemberSession = createAuthenticatedSession(nonMember);
      getMockedSession().mockResolvedValue(nonMemberSession);

      const body = {
        messages: [{ role: "user", content: "test" }],
      };

      const request = createPostRequest("/api/workspaces/test/conversations/share", body);
      const response = await ShareConversationPOST(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });

      expectForbidden(response);
    });

    test("should return 404 for non-existent workspace", async () => {
      const { ownerSession } = await createTestFixtures();

      // Ensure session is mocked before API call
      getMockedSession().mockResolvedValue(ownerSession);

      const body = {
        messages: [{ role: "user", content: "test" }],
      };

      const request = createPostRequest("/api/workspaces/test/conversations/share", body);
      const response = await ShareConversationPOST(request, {
        params: Promise.resolve({ slug: "non-existent-workspace" }),
      });

      expectNotFound(response);
    });

    test("should enforce share code uniqueness", async () => {
      const { owner, ownerSession, workspace, workspaceSlug } = await createTestFixtures();

      // Ensure session is mocked before API calls
      getMockedSession().mockResolvedValue(ownerSession);

      const messages = [{ role: "user", content: "test" }];
      const body = { messages };

      // Create first shared conversation
      const request1 = createPostRequest("/api/workspaces/test/conversations/share", body);
      const response1 = await ShareConversationPOST(request1, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const data1 = await response1.json();

      // Create second shared conversation
      const request2 = createPostRequest("/api/workspaces/test/conversations/share", body);
      const response2 = await ShareConversationPOST(request2, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const data2 = await response2.json();

      // Verify different share codes
      expect(data1.shareCode).not.toBe(data2.shareCode);

      const created1 = await db.sharedConversation.findUnique({
        where: { shareCode: data1.shareCode },
      });
      const created2 = await db.sharedConversation.findUnique({
        where: { shareCode: data2.shareCode },
      });

      if (created1) createdSharedConversationIds.push(created1.id);
      if (created2) createdSharedConversationIds.push(created2.id);
    });
  });

  describe("GET /api/workspaces/[slug]/shared/conversations/[shareCode]", () => {
    test("should retrieve shared conversation for workspace member", async () => {
      const { owner, ownerSession, workspace, workspaceSlug, memberUser, memberSession } =
        await createTestFixtures({ includeSecondUser: true, userRole: "DEVELOPER" });

      // Create a shared conversation
      const messages = [
        {
          role: "user",
          content: "Shared message",
          timestamp: new Date().toISOString(),
        },
      ];

      const sharedConv = await db.sharedConversation.create({
        data: {
          shareCode: "TEST1234",
          title: "Shared Test",
          workspaceId: workspace.id,
          createdById: owner.id,
          messages: messages,
        },
      });
      createdSharedConversationIds.push(sharedConv.id);

      // Member session is already mocked in createTestFixtures
      // Just ensure it's still set
      getMockedSession().mockResolvedValue(memberSession!);

      const request = createGetRequest(
        `/api/workspaces/${workspaceSlug}/shared/conversations/TEST1234`
      );
      const response = await GetSharedConversationGET(request, {
        params: Promise.resolve({ slug: workspaceSlug, shareCode: "TEST1234" }),
      });

      expectSuccess(response);
      const data = await response.json();

      expect(data.shareCode).toBe("TEST1234");
      expect(data.title).toBe("Shared Test");
      expect(data.messages).toEqual(messages);
      expect(data.workspace.slug).toBe(workspaceSlug);
      expect(data.createdBy.id).toBe(owner.id);
      expect(data.createdBy.name).toBe("Test Owner");
    });

    test("should return 403 for non-workspace member", async () => {
      const { owner, workspace, workspaceSlug } = await createTestFixtures();

      // Create a shared conversation
      const sharedConv = await db.sharedConversation.create({
        data: {
          shareCode: "TEST5678",
          workspaceId: workspace.id,
          createdById: owner.id,
          messages: [{ role: "user", content: "test" }],
        },
      });
      createdSharedConversationIds.push(sharedConv.id);

      // Create a different user not in workspace
      const nonMemberId = generateUniqueId();
      const nonMember = await db.user.create({
        data: {
          id: nonMemberId,
          name: "Non Member",
          email: `non-member-${nonMemberId}@test.com`,
        },
      });
      createdUserIds.push(nonMemberId);

      // Mock session for non-member
      const nonMemberSession = createAuthenticatedSession(nonMember);
      getMockedSession().mockResolvedValue(nonMemberSession);

      const request = createGetRequest(
        `/api/workspaces/${workspaceSlug}/shared/conversations/TEST5678`
      );
      const response = await GetSharedConversationGET(request, {
        params: Promise.resolve({ slug: workspaceSlug, shareCode: "TEST5678" }),
      });

      expectForbidden(response);
      const data = await response.json();
      expect(data.error).toContain("must be a member");
    });

    test("should return 404 for invalid share code", async () => {
      const { ownerSession, workspaceSlug } = await createTestFixtures();

      // Ensure owner session is mocked before API call
      getMockedSession().mockResolvedValue(ownerSession);

      const request = createGetRequest(
        `/api/workspaces/${workspaceSlug}/shared/conversations/INVALID99`
      );
      const response = await GetSharedConversationGET(request, {
        params: Promise.resolve({ slug: workspaceSlug, shareCode: "INVALID99" }),
      });

      expectNotFound(response);
    });

    test("should return 401 for unauthenticated requests", async () => {
      // Mock unauthenticated session FIRST
      getMockedSession().mockResolvedValue(null);
      
      const { workspaceSlug } = await createTestFixtures();
      
      // Re-mock to ensure no session
      getMockedSession().mockResolvedValue(null);

      const request = createGetRequest(
        `/api/workspaces/${workspaceSlug}/shared/conversations/TEST1234`
      );
      const response = await GetSharedConversationGET(request, {
        params: Promise.resolve({ slug: workspaceSlug, shareCode: "TEST1234" }),
      });

      expectUnauthorized(response);
    });

    test("should properly deserialize messages with complex data", async () => {
      const { owner, ownerSession, workspace, workspaceSlug } = await createTestFixtures();

      const complexMessages = [
        {
          role: "user",
          content: "Complex message",
          timestamp: new Date().toISOString(),
          imageData: ["https://example.com/img1.jpg", "https://example.com/img2.jpg"],
        },
        {
          role: "assistant",
          content: "Analysis complete",
          timestamp: new Date().toISOString(),
          toolCalls: [
            {
              id: "tool-1",
              name: "analyze_images",
              arguments: { count: 2 },
              result: { status: "success" },
            },
          ],
        },
      ];

      const sharedConv = await db.sharedConversation.create({
        data: {
          shareCode: "COMPLEX1",
          title: "Complex Conversation",
          workspaceId: workspace.id,
          createdById: owner.id,
          messages: complexMessages,
        },
      });
      createdSharedConversationIds.push(sharedConv.id);

      // Ensure owner session is mocked before API call
      getMockedSession().mockResolvedValue(ownerSession);

      const request = createGetRequest(
        `/api/workspaces/${workspaceSlug}/shared/conversations/COMPLEX1`
      );
      const response = await GetSharedConversationGET(request, {
        params: Promise.resolve({ slug: workspaceSlug, shareCode: "COMPLEX1" }),
      });

      expectSuccess(response);
      const data = await response.json();

      expect(data.messages).toEqual(complexMessages);
      expect(data.messages[0].imageData).toHaveLength(2);
      expect(data.messages[1].toolCalls).toHaveLength(1);
      expect(data.messages[1].toolCalls[0].result).toEqual({ status: "success" });
    });
  });
});
