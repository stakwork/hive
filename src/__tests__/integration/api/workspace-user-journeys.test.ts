import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/user-journeys/route";
import { db } from "@/lib/db";
import { TaskSourceType, WorkflowStatus } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  createGetRequest,
  expectSuccess,
  expectUnauthorized,
  expectError,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { EncryptionService } from "@/lib/encryption";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Mock graph API and GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Test data factory for creating complete workspace setup with swarm
async function createUserJourneyTestSetup() {
  const enc = EncryptionService.getInstance();
  const testGithubToken = "ghp_test_token_12345";
  const testGithubUsername = "test-user";
  const testSwarmUrl = "https://test-swarm.sphinx.chat/api";
  const testSwarmApiKey = "swarm_api_key_12345";

  const testData = await db.$transaction(async (tx) => {
    // Create user
    const user = await tx.user.create({
      data: {
        email: `user-${generateUniqueId()}@example.com`,
        name: "Test User",
      },
    });

    // Create GitHub auth for user
    await tx.gitHubAuth.create({
      data: {
        userId: user.id,
        githubUserId: generateUniqueId(),
        githubUsername: testGithubUsername,
        githubNodeId: `node_${generateUniqueId()}`,
      },
    });

    // Create GitHub OAuth account with encrypted token
    await tx.account.create({
      data: {
        userId: user.id,
        type: "oauth",
        provider: "github",
        providerAccountId: generateUniqueId(),
        access_token: JSON.stringify(
          enc.encryptField("access_token", testGithubToken)
        ),
        scope: "repo,user",
      },
    });

    // Create workspace
    const workspace = await tx.workspace.create({
      data: {
        name: "Test Workspace",
        slug: generateUniqueSlug("test-workspace"),
        ownerId: user.id,
      },
    });

    // Create workspace membership
    await tx.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
      },
    });

    // Create repository for workspace
    const repository = await tx.repository.create({
      data: {
        name: "test-repo",
        repositoryUrl: "https://github.com/test/repo",
        branch: "main",
        workspaceId: workspace.id,
      },
    });

    // Create swarm for workspace
    const swarm = await tx.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        swarmId: generateUniqueId("swarm"),
        swarmUrl: testSwarmUrl,
        swarmSecretAlias: "{{SWARM_TEST_API_KEY}}",
        swarmApiKey: JSON.stringify(
          enc.encryptField("swarmApiKey", testSwarmApiKey)
        ),
        poolName: "test-pool",
        services: [],
        agentRequestId: null,
        agentStatus: null,
      },
    });

    return { user, workspace, swarm, repository };
  });

  return {
    ...testData,
    testGithubToken,
    testGithubUsername,
    testSwarmUrl,
  };
}

// Helper to create test task with user journey source type
async function createUserJourneyTask(
  workspaceId: string,
  userId: string,
  repositoryId: string,
  options?: {
    title?: string;
    testFilePath?: string;
    workflowStatus?: WorkflowStatus;
    withMergedPR?: boolean;
  }
) {
  const taskId = generateUniqueId("task");
  const testFilePath = options?.testFilePath || `src/__tests__/e2e/test-${taskId}.spec.ts`;

  const task = await db.task.create({
    data: {
      id: taskId,
      title: options?.title || `User Journey Task ${taskId}`,
      description: "Test user journey",
      workspaceId,
      createdById: userId,
      updatedById: userId,
      sourceType: TaskSourceType.USER_JOURNEY,
      testFilePath,
      testFileUrl: `https://github.com/test/repo/blob/main/${testFilePath}`,
      workflowStatus: options?.workflowStatus || WorkflowStatus.PENDING,
      repositoryId,
    },
  });

  // Create chat message with PR artifact if requested
  if (options?.withMergedPR) {
    const chatMessage = await db.chatMessage.create({
      data: {
        taskId: task.id,
        message: "PR created",
        role: "ASSISTANT",
        timestamp: new Date(),
      },
    });

    await db.artifact.create({
      data: {
        messageId: chatMessage.id,
        type: "PULL_REQUEST",
        content: {
          url: "https://github.com/test/repo/pull/123",
          number: 123,
          status: "DONE",
          title: "Test PR",
        },
      },
    });
  }

  return task;
}

describe("GET /api/workspaces/[slug]/user-journeys - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset fetch mock
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    test("returns 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/test-slug/user-journeys"
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-slug" }),
      });

      await expectUnauthorized(response);
    });

    test("returns 401 for invalid user session (missing userId)", async () => {
      getMockedSession().mockResolvedValue({
        user: { name: "Test" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/test-slug/user-journeys"
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-slug" }),
      });

      await expectError(response, "Invalid user session", 401);
    });
  });

  describe("Authorization", () => {
    test("returns 404 for non-existent workspace", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/non-existent-slug/user-journeys"
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "non-existent-slug" }),
      });

      await expectError(response, "Workspace not found", 404);
    });

    test("returns 403 for non-member access", async () => {
      const { workspace } = await createUserJourneyTestSetup();
      const nonMember = await createTestUser({
        email: `non-member-${generateUniqueId()}@example.com`,
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(nonMember)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Access denied", 403);
    });

    test("returns 404 for deleted workspace", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();

      // Soft delete workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Workspace not found", 404);
    });

    test("allows workspace owner to access", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock graph API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectSuccess(response, 200);
    });

    test("allows workspace member to access", async () => {
      const { workspace } = await createUserJourneyTestSetup();
      const member = await createTestUser({
        email: `member-${generateUniqueId()}@example.com`,
      });

      // Add member to workspace
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: member.id,
          role: "DEVELOPER",
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(member)
      );

      // Mock graph API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectSuccess(response, 200);
    });
  });

  describe("Data Retrieval & Aggregation", () => {
    test("returns empty array when no user journeys exist", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock graph API response with no nodes
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data).toEqual([]);
    });

    test("returns tasks-only data when no graph nodes exist", async () => {
      const { user, workspace, repository } = await createUserJourneyTestSetup();

      // Create test tasks
      await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "Test Journey 1",
        testFilePath: "src/__tests__/e2e/test-1.spec.ts",
        workflowStatus: WorkflowStatus.PENDING,
      });

      await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "Test Journey 2",
        testFilePath: "src/__tests__/e2e/test-2.spec.ts",
        workflowStatus: WorkflowStatus.COMPLETED,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock graph API response with no nodes
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.data.every((item: any) => item.type === "TASK")).toBe(true);
    });

    test("returns graph nodes when no tasks exist", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock graph API response with nodes
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              ref_id: "node-1",
              properties: {
                name: "Login E2E Test",
                file: "src/__tests__/e2e/login.spec.ts",
                body: "test('user can login', async () => { ... });",
                test_kind: "e2e",
              },
            },
          ],
        }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0]).toMatchObject({
        id: "node-1",
        title: "Login E2E Test",
        type: "GRAPH_NODE",
        testFilePath: "src/__tests__/e2e/login.spec.ts",
        testFileUrl: "https://github.com/test/repo/blob/main/src/__tests__/e2e/login.spec.ts",
      });
      expect(data.data[0].graphNode).toBeDefined();
      expect(data.data[0].graphNode.body).toContain("user can login");
    });

    test("returns combined data from tasks and graph nodes", async () => {
      const { user, workspace, repository } = await createUserJourneyTestSetup();

      // Create test task
      await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "Test Journey Task",
        testFilePath: "src/__tests__/e2e/task-test.spec.ts",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock graph API response with nodes
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              ref_id: "node-1",
              properties: {
                name: "Graph Node Test",
                file: "src/__tests__/e2e/graph-test.spec.ts",
                body: "test('graph test', () => {});",
                test_kind: "e2e",
              },
            },
          ],
        }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);

      const taskItems = data.data.filter((item: any) => item.type === "TASK");
      const graphItems = data.data.filter((item: any) => item.type === "GRAPH_NODE");

      expect(taskItems).toHaveLength(1);
      expect(graphItems).toHaveLength(1);
    });

    test("correctly sorts by createdAt descending (newest first)", async () => {
      const { user, workspace, repository } = await createUserJourneyTestSetup();

      // Create tasks with different timestamps
      const oldTask = await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "Old Task",
      });

      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      const newTask = await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "New Task",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock graph API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);

      // Verify newest task is first
      expect(data.data[0].title).toBe("New Task");
      expect(data.data[1].title).toBe("Old Task");

      // Verify timestamps are descending
      const timestamps = data.data.map((item: any) => new Date(item.createdAt).getTime());
      for (let i = 0; i < timestamps.length - 1; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]);
      }
    });

    test("filters out tasks with merged PRs (status DONE)", async () => {
      const { user, workspace, repository } = await createUserJourneyTestSetup();

      // Create task with merged PR
      await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "Merged PR Task",
        withMergedPR: true,
      });

      // Create task without PR
      await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "Pending Task",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock GitHub API for PR status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: "https://github.com/test/repo/pull/123",
          number: 123,
          state: "closed",
          merged: true,
          title: "Test PR",
        }),
      });

      // Mock graph API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      
      // Should only return the pending task (merged PR task filtered out)
      const taskTitles = data.data.map((item: any) => item.title);
      expect(taskTitles).not.toContain("Merged PR Task");
      expect(taskTitles).toContain("Pending Task");
    });

    test("handles missing swarm gracefully (no graph nodes)", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Workspace Without Swarm",
      });

      // Create workspace membership
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: "OWNER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data).toEqual([]);
      
      // Verify fetch was not called for graph API (no swarm)
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("handles graph API errors gracefully", async () => {
      const { user, workspace, repository } = await createUserJourneyTestSetup();

      // Create test task
      await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "Test Task",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock graph API error
      mockFetch.mockRejectedValueOnce(new Error("Graph API error"));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      // Should still return task data despite graph API failure
      expect(data.data).toHaveLength(1);
      expect(data.data[0].type).toBe("TASK");
    });
  });

  describe("Data Completeness", () => {
    test("validates complete task row structure", async () => {
      const { user, workspace, repository } = await createUserJourneyTestSetup();

      await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "Complete Task Test",
        testFilePath: "src/__tests__/e2e/complete.spec.ts",
        workflowStatus: WorkflowStatus.COMPLETED,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock graph API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.data).toHaveLength(1);

      const taskRow = data.data[0];

      // Validate required fields
      expect(taskRow).toHaveProperty("id");
      expect(taskRow).toHaveProperty("title");
      expect(taskRow).toHaveProperty("type");
      expect(taskRow).toHaveProperty("testFilePath");
      expect(taskRow).toHaveProperty("testFileUrl");
      expect(taskRow).toHaveProperty("createdAt");
      expect(taskRow).toHaveProperty("badge");

      // Validate type-specific fields
      expect(taskRow.type).toBe("TASK");
      expect(taskRow).toHaveProperty("task");
      expect(taskRow.task).toHaveProperty("description");
      expect(taskRow.task).toHaveProperty("status");
      expect(taskRow.task).toHaveProperty("workflowStatus");
      expect(taskRow.task).toHaveProperty("stakworkProjectId");
      expect(taskRow.task).toHaveProperty("repository");

      // Validate badge structure
      expect(taskRow.badge).toHaveProperty("type");
      expect(taskRow.badge).toHaveProperty("text");
    });

    test("validates complete graph node row structure", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock graph API response with complete node
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              ref_id: "node-complete",
              properties: {
                name: "Complete Graph Node",
                file: "src/__tests__/e2e/complete.spec.ts",
                body: "test('complete test', () => {});",
                test_kind: "e2e",
              },
            },
          ],
        }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.data).toHaveLength(1);

      const graphRow = data.data[0];

      // Validate required fields
      expect(graphRow).toHaveProperty("id");
      expect(graphRow).toHaveProperty("title");
      expect(graphRow).toHaveProperty("type");
      expect(graphRow).toHaveProperty("testFilePath");
      expect(graphRow).toHaveProperty("testFileUrl");
      expect(graphRow).toHaveProperty("createdAt");
      expect(graphRow).toHaveProperty("badge");

      // Validate type-specific fields
      expect(graphRow.type).toBe("GRAPH_NODE");
      expect(graphRow).toHaveProperty("graphNode");
      expect(graphRow.graphNode).toHaveProperty("body");
      expect(graphRow.graphNode).toHaveProperty("testKind");

      // Validate badge structure (LIVE for graph nodes)
      expect(graphRow.badge).toHaveProperty("type");
      expect(graphRow.badge).toHaveProperty("text");
      expect(graphRow.badge.type).toBe("LIVE");
    });

    test("validates badge calculation for different workflow statuses", async () => {
      const { user, workspace, repository } = await createUserJourneyTestSetup();

      // Create tasks with different workflow statuses
      await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "Pending Task",
        workflowStatus: WorkflowStatus.PENDING,
      });

      await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "In Progress Task",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });

      await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "Completed Task",
        workflowStatus: WorkflowStatus.COMPLETED,
      });

      await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "Failed Task",
        workflowStatus: WorkflowStatus.FAILED,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock graph API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.data).toHaveLength(4);

      // Verify each task has correct badge
      data.data.forEach((item: any) => {
        expect(item.badge).toBeDefined();
        expect(item.badge.type).toBeDefined();
        expect(item.badge.text).toBeDefined();
      });
    });

    test("validates GitHub URL construction for test files", async () => {
      const { user, workspace, repository } = await createUserJourneyTestSetup();

      await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "Test with File Path",
        testFilePath: "src/__tests__/e2e/nested/test.spec.ts",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock graph API response with file path
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              ref_id: "node-with-path",
              properties: {
                name: "Graph Test",
                file: "src/__tests__/e2e/graph/test.spec.ts",
                body: "test('graph', () => {});",
                test_kind: "e2e",
              },
            },
          ],
        }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.data).toHaveLength(2);

      // Verify task has GitHub URL
      const taskItem = data.data.find((item: any) => item.type === "TASK");
      expect(taskItem.testFileUrl).toMatch(/^https:\/\/github\.com\//);
      expect(taskItem.testFileUrl).toContain("/blob/");
      expect(taskItem.testFileUrl).toContain(taskItem.testFilePath);

      // Verify graph node has GitHub URL
      const graphItem = data.data.find((item: any) => item.type === "GRAPH_NODE");
      expect(graphItem.testFileUrl).toMatch(/^https:\/\/github\.com\//);
      expect(graphItem.testFileUrl).toContain("/blob/main/");
      expect(graphItem.testFileUrl).toContain(graphItem.testFilePath);
    });
  });

  describe("Error Handling", () => {
    test("returns 500 for database errors", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Force database error by using invalid workspace ID
      const invalidWorkspace = { ...workspace, id: null as any };

      // Mock db.workspace.findFirst to throw error
      const originalFindFirst = db.workspace.findFirst;
      db.workspace.findFirst = vi.fn().mockRejectedValue(new Error("Database error"));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      // Restore original function
      db.workspace.findFirst = originalFindFirst;

      await expectError(response, "Failed to fetch user journeys", 500);
    });

    test("validates response format consistency", async () => {
      const { user, workspace, repository } = await createUserJourneyTestSetup();

      // Create mixed data
      await createUserJourneyTask(workspace.id, user.id, repository.id, {
        title: "Task 1",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock graph API with node
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              ref_id: "node-1",
              properties: {
                name: "Node 1",
                file: "test.spec.ts",
                body: "test",
                test_kind: "e2e",
              },
            },
          ],
        }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/user-journeys`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      // Validate top-level response format
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("data");
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);

      // Validate all items have consistent base structure
      data.data.forEach((item: any) => {
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("title");
        expect(item).toHaveProperty("type");
        expect(item).toHaveProperty("testFilePath");
        expect(item).toHaveProperty("createdAt");
        expect(item).toHaveProperty("badge");

        // Validate type-specific structure
        if (item.type === "TASK") {
          expect(item).toHaveProperty("task");
          expect(item).not.toHaveProperty("graphNode");
        } else if (item.type === "GRAPH_NODE") {
          expect(item).toHaveProperty("graphNode");
          expect(item).not.toHaveProperty("task");
        }
      });
    });
  });
});