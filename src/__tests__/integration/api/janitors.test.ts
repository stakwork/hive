import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET as GetConfig, PUT as UpdateConfig } from "@/app/api/workspaces/[slug]/janitors/config/route";
import { POST as TriggerRun } from "@/app/api/workspaces/[slug]/janitors/[type]/run/route";
import { GET as GetRuns } from "@/app/api/workspaces/[slug]/janitors/runs/route";
import { GET as GetRecommendations } from "@/app/api/workspaces/[slug]/janitors/recommendations/route";
import { POST as AcceptRecommendation } from "@/app/api/janitors/recommendations/[id]/accept/route";
import { POST as DismissRecommendation } from "@/app/api/janitors/recommendations/[id]/dismiss/route";
import { POST as WebhookHandler } from "@/app/api/janitors/webhook/route";
import { WorkspaceRole } from "@prisma/client";
import { db } from "@/lib/db";
import { stakworkService } from "@/lib/service-factory";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  generateUniqueId,
  generateUniqueSlug,
  createGetRequest,
  createPostRequest,
  createPutRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";

// Mock Stakwork service
vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({
    stakworkRequest: vi.fn(),
  })),
}));

// Mock environment config
vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_JANITOR_WORKFLOW_ID: "123",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  },
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    POOL_MANAGER_BASE_URL: "https://workspaces.sphinx.chat/api",
    API_TIMEOUT: 10000,
  },
}));

const mockStakworkService = stakworkService as vi.MockedFunction<typeof stakworkService>;

describe("Janitor API Integration Tests", () => {
  async function createTestWorkspaceWithUser(role: WorkspaceRole = "OWNER") {
    return await db.$transaction(async (tx) => {
      // Create the test user
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      if (role === "OWNER") {
        // If role is OWNER, make them the actual workspace owner
        const workspace = await tx.workspace.create({
          data: {
            name: `Test Workspace ${generateUniqueId()}`,
            slug: generateUniqueSlug("test-workspace"),
            ownerId: user.id,
          },
        });

        await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: user.id,
            role: "OWNER",
          },
        });

        return { user, workspace };
      } else {
        // For non-OWNER roles, create a separate owner and add user as member
        const owner = await tx.user.create({
          data: {
            id: generateUniqueId("owner"),
            email: `owner-${generateUniqueId()}@example.com`,
            name: "Workspace Owner",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: `Test Workspace ${generateUniqueId()}`,
            slug: generateUniqueSlug("test-workspace"),
            ownerId: owner.id,
          },
        });

        // Create owner membership
        await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: owner.id,
            role: "OWNER",
          },
        });

        // Create test user membership with specified role
        await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: user.id,
            role: role,
          },
        });

        return { user, workspace };
      }
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set up required environment variables for tests
    process.env.STAKWORK_API_KEY = "test-api-key";
    process.env.STAKWORK_JANITOR_WORKFLOW_ID = "123";
    
    // Set up default Stakwork service mock
    const mockStakworkRequest = vi.fn().mockResolvedValue({
      success: true,
      data: { project_id: 123 }
    });
    
    mockStakworkService.mockReturnValue({
      stakworkRequest: mockStakworkRequest
    } as any);
  });

  describe("Janitor Configuration", () => {
    test("GET /api/workspaces/[slug]/janitors/config - should get janitor config", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("OWNER");
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createGetRequest("http://localhost/api/test");
      
      const response = await GetConfig(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData).toHaveProperty("config");
      expect(responseData.config).toMatchObject({
        workspaceId: workspace.id,
        unitTestsEnabled: false,
        integrationTestsEnabled: false,
      });
    });

    test("PUT /api/workspaces/[slug]/janitors/config - should update janitor config", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createPutRequest("http://localhost/api/test", {
        unitTestsEnabled: true,
        integrationTestsEnabled: false,
      });
      
      const response = await UpdateConfig(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.config.unitTestsEnabled).toBe(true);
      expect(responseData.config.integrationTestsEnabled).toBe(false);
    });

    test("PUT /api/workspaces/[slug]/janitors/config - should reject unauthorized user", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("VIEWER");
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createPutRequest("http://localhost/api/test", {
        unitTestsEnabled: true,
      });
      
      const response = await UpdateConfig(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectForbidden(response);
    });

    test("GET /api/workspaces/[slug]/janitors/config - should reject unauthenticated user", async () => {
      const { workspace } = await createTestWorkspaceWithUser();
      
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest("http://localhost/api/test");
      
      const response = await GetConfig(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectUnauthorized(response);
    });
  });

  describe("Janitor Execution", () => {
    test("POST /api/workspaces/[slug]/janitors/[type]/run - should trigger janitor run when enabled", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // First enable unit tests
      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createPostRequest("http://localhost/api/test", {});
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ 
          slug: workspace.slug, 
          type: "unit_tests" 
        }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.run).toMatchObject({
        janitorType: "UNIT_TESTS",
        status: "RUNNING",
        triggeredBy: "MANUAL",
      });

      // Verify database record was created
      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
      });
      expect(runs).toHaveLength(1);
      expect(runs[0].janitorType).toBe("UNIT_TESTS");
    });

    test("POST /api/workspaces/[slug]/janitors/[type]/run - should reject when janitor disabled", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createPostRequest("http://localhost/api/test", {});
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ 
          slug: workspace.slug, 
          type: "unit_tests" 
        }),
      });

      expect(response.status).toBe(400);
      const responseData = await response.json();
      expect(responseData.error).toContain("not enabled");
    });

    test("POST /api/workspaces/[slug]/janitors/[type]/run - should reject invalid janitor type", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createPostRequest("http://localhost/api/test", {});
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ 
          slug: workspace.slug, 
          type: "invalid_type" 
        }),
      });

      expect(response.status).toBe(400);
      const responseData = await response.json();
      expect(responseData.error).toContain("Invalid janitor type");
    });

    test("POST /api/workspaces/[slug]/janitors/[type]/run - should allow concurrent runs", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable unit tests and create existing run
      const config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      await db.janitorRun.create({
        data: {
          janitorConfigId: config.id,
          janitorType: "UNIT_TESTS",
          triggeredBy: "MANUAL",
          status: "RUNNING",
        },
      });
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createPostRequest("http://localhost/api/test", {});
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ 
          slug: workspace.slug, 
          type: "unit_tests" 
        }),
      });

      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.success).toBe(true);
      expect(responseData.run.janitorType).toBe("UNIT_TESTS");
    });

    test("POST /api/workspaces/[slug]/janitors/[type]/run - should trigger MOCK_GENERATION run when enabled", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");

      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          mockGenerationEnabled: true,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createPostRequest("http://localhost/api/test", {});

      const response = await TriggerRun(request, {
        params: Promise.resolve({
          slug: workspace.slug,
          type: "mock_generation"
        }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.run).toMatchObject({
        janitorType: "MOCK_GENERATION",
        status: "RUNNING",
        triggeredBy: "MANUAL",
      });

      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
      });
      expect(runs).toHaveLength(1);
      expect(runs[0].janitorType).toBe("MOCK_GENERATION");
    });
  });

  describe("Janitor Runs", () => {
    test("GET /api/workspaces/[slug]/janitors/runs - should get runs with pagination", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("DEVELOPER");
      
      // Create test data
      const config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      await db.janitorRun.createMany({
        data: [
          {
            janitorConfigId: config.id,
            janitorType: "UNIT_TESTS",
            triggeredBy: "MANUAL",
            status: "COMPLETED",
          },
          {
            janitorConfigId: config.id,
            janitorType: "INTEGRATION_TESTS", 
            triggeredBy: "SCHEDULED",
            status: "FAILED",
          },
        ],
      });
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createGetRequest("http://localhost/api/test", { limit: "10", page: "1" });
      
      const response = await GetRuns(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData).toHaveProperty("runs");
      expect(responseData).toHaveProperty("pagination");
      expect(responseData.runs).toHaveLength(2);
      expect(responseData.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: 2,
      });
    });

    test("GET /api/workspaces/[slug]/janitors/runs - should filter by janitor type", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("DEVELOPER");
      
      const config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      await db.janitorRun.createMany({
        data: [
          {
            janitorConfigId: config.id,
            janitorType: "UNIT_TESTS",
            triggeredBy: "MANUAL",
            status: "COMPLETED",
          },
          {
            janitorConfigId: config.id,
            janitorType: "INTEGRATION_TESTS",
            triggeredBy: "MANUAL", 
            status: "COMPLETED",
          },
        ],
      });
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createGetRequest("http://localhost/api/test", { type: "UNIT_TESTS" });
      
      const response = await GetRuns(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.runs).toHaveLength(1);
      expect(responseData.runs[0].janitorType).toBe("UNIT_TESTS");
    });
  });

  describe("Webhook Processing", () => {
    test("POST /api/janitors/webhook - should process successful webhook", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser();
      
      // Create test janitor run
      const config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: config.id,
          janitorType: "UNIT_TESTS",
          triggeredBy: "MANUAL",
          status: "RUNNING",
          stakworkProjectId: 12345,
        },
      });

      const webhookPayload = {
        projectId: 12345,
        status: "completed",
        results: {
          recommendations: [
            {
              title: "Add unit tests for UserService",
              description: "UserService class lacks unit test coverage",
              priority: "HIGH",
              impact: "Improves code reliability",
            },
          ],
        },
      };

      const request = createPostRequest("http://localhost/api/test", webhookPayload);
      
      const response = await WebhookHandler(request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.status).toBe("COMPLETED");

      // Verify database updates
      const updatedRun = await db.janitorRun.findUnique({
        where: { id: janitorRun.id },
        include: { recommendations: true },
      });

      expect(updatedRun?.status).toBe("COMPLETED");
      expect(updatedRun?.recommendations).toHaveLength(1);
      expect(updatedRun?.recommendations[0].title).toBe("Add unit tests for UserService");
      expect(updatedRun?.recommendations[0].priority).toBe("HIGH");
    });

    test("POST /api/janitors/webhook - should handle failed webhook", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser();
      
      const config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: config.id,
          janitorType: "UNIT_TESTS",
          triggeredBy: "MANUAL",
          status: "RUNNING",
          stakworkProjectId: 54321,
        },
      });

      const webhookPayload = {
        projectId: 54321,
        status: "failed",
        error: "Analysis timed out",
      };

      const request = createPostRequest("http://localhost/api/test", webhookPayload);
      
      const response = await WebhookHandler(request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.status).toBe("FAILED");

      // Verify database updates
      const updatedRun = await db.janitorRun.findUnique({
        where: { id: janitorRun.id },
      });

      expect(updatedRun?.status).toBe("FAILED");
      expect(updatedRun?.error).toContain("Analysis timed out");
    });

    test("POST /api/janitors/webhook - should return 404 for unknown project", async () => {
      const webhookPayload = {
        projectId: 99999,
        status: "completed",
      };

      const request = createPostRequest("http://localhost/api/test", webhookPayload);
      
      const response = await WebhookHandler(request);

      expect(response.status).toBe(404);
    });
  });

  describe("Recommendation Management", () => {
    test("GET /api/workspaces/[slug]/janitors/recommendations - should get recommendations with pagination", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("DEVELOPER");
      
      // Create test data
      const config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: config.id,
          janitorType: "UNIT_TESTS",
          triggeredBy: "MANUAL",
          status: "COMPLETED",
        },
      });

      await db.janitorRecommendation.createMany({
        data: [
          {
            janitorRunId: janitorRun.id,
            workspaceId: workspace.id,
            title: "Add unit tests for UserService",
            description: "UserService needs test coverage",
            priority: "HIGH",
            status: "PENDING",
          },
          {
            janitorRunId: janitorRun.id,
            workspaceId: workspace.id,
            title: "Add integration tests",
            description: "Missing integration test coverage",
            priority: "MEDIUM",
            status: "ACCEPTED",
            acceptedById: user.id,
            acceptedAt: new Date(),
          },
        ],
      });
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createGetRequest("http://localhost/api/test", { limit: "10", page: "1" });
      
      const response = await GetRecommendations(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData).toHaveProperty("recommendations");
      expect(responseData).toHaveProperty("pagination");
      expect(responseData.recommendations).toHaveLength(1);
      expect(responseData.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: 1,
      });

      // Verify recommendation data structure
      const pendingRec = responseData.recommendations.find((r: any) => r.status === "PENDING");
      
      expect(pendingRec).toMatchObject({
        title: "Add unit tests for UserService",
        priority: "HIGH",
        status: "PENDING",
      });
    });

    test("GET /api/workspaces/[slug]/janitors/recommendations - should filter by status", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("DEVELOPER");
      
      const config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: config.id,
          janitorType: "UNIT_TESTS",
          triggeredBy: "MANUAL",
          status: "COMPLETED",
        },
      });

      await db.janitorRecommendation.createMany({
        data: [
          {
            janitorRunId: janitorRun.id,
            workspaceId: workspace.id,
            title: "Pending recommendation",
            description: "This is pending",
            priority: "HIGH",
            status: "PENDING",
          },
          {
            janitorRunId: janitorRun.id,
            workspaceId: workspace.id,
            title: "Accepted recommendation",
            description: "This is accepted",
            priority: "MEDIUM",
            status: "ACCEPTED",
            acceptedById: user.id,
            acceptedAt: new Date(),
          },
        ],
      });
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createGetRequest("http://localhost/api/test", { status: "PENDING" });
      
      const response = await GetRecommendations(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.recommendations).toHaveLength(1);
      expect(responseData.recommendations[0].status).toBe("PENDING");
      expect(responseData.recommendations[0].title).toBe("Pending recommendation");
    });

    test("GET /api/workspaces/[slug]/janitors/recommendations - should filter by priority", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("DEVELOPER");
      
      const config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: config.id,
          janitorType: "UNIT_TESTS",
          triggeredBy: "MANUAL",
          status: "COMPLETED",
        },
      });

      await db.janitorRecommendation.createMany({
        data: [
          {
            janitorRunId: janitorRun.id,
            workspaceId: workspace.id,
            title: "High priority recommendation",
            description: "This is high priority",
            priority: "HIGH",
            status: "PENDING",
          },
          {
            janitorRunId: janitorRun.id,
            workspaceId: workspace.id,
            title: "Low priority recommendation",
            description: "This is low priority",
            priority: "LOW",
            status: "PENDING",
          },
        ],
      });
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createGetRequest("http://localhost/api/test", { priority: "HIGH" });
      
      const response = await GetRecommendations(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.recommendations).toHaveLength(1);
      expect(responseData.recommendations[0].priority).toBe("HIGH");
      expect(responseData.recommendations[0].title).toBe("High priority recommendation");
    });

    test("GET /api/workspaces/[slug]/janitors/recommendations - should return empty array when no janitor config exists", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("DEVELOPER");
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createGetRequest("http://localhost/api/test");
      
      const response = await GetRecommendations(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.recommendations).toHaveLength(0);
      expect(responseData.pagination.total).toBe(0);
    });

    test("GET /api/workspaces/[slug]/janitors/recommendations - should reject unauthorized user", async () => {
      const { workspace } = await createTestWorkspaceWithUser();
      
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest("http://localhost/api/test");
      
      const response = await GetRecommendations(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectUnauthorized(response);
    });

    test("POST /api/janitors/recommendations/[id]/accept - should accept recommendation and create task", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Create test data
      const config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: config.id,
          janitorType: "UNIT_TESTS",
          triggeredBy: "MANUAL",
          status: "COMPLETED",
        },
      });

      const recommendation = await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: workspace.id,
          title: "Add unit tests",
          description: "Need more test coverage",
          priority: "HIGH",
          status: "PENDING",
        },
      });
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createPostRequest("http://localhost/api/test", {});
      
      const response = await AcceptRecommendation(request, {
        params: Promise.resolve({ id: recommendation.id }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.task).toHaveProperty("id");
      expect(responseData.task.title).toBe("Add unit tests");
      // Stakwork returns success and project_id immediately, actual results come via webhook
      if (responseData.workflow) {
        expect(responseData.workflow).toHaveProperty("success");
        // May have project_id if Stakwork integration is configured
      }

      // Verify database updates
      const updatedRecommendation = await db.janitorRecommendation.findUnique({
        where: { id: recommendation.id },
      });
      expect(updatedRecommendation?.status).toBe("ACCEPTED");

      const task = await db.task.findFirst({
        where: { title: "Add unit tests" },
      });
      expect(task).toBeTruthy();
      expect(task?.sourceType).toBe("JANITOR");
      expect(task?.status).toBe("IN_PROGRESS");
    });

    test("POST /api/janitors/recommendations/[id]/dismiss - should dismiss recommendation", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      const config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: config.id,
          janitorType: "UNIT_TESTS",
          triggeredBy: "MANUAL",
          status: "COMPLETED",
        },
      });

      const recommendation = await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: workspace.id,
          title: "Add unit tests",
          description: "Need more test coverage",
          priority: "LOW",
          status: "PENDING",
        },
      });
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user) as any);

      const request = createPostRequest("http://localhost/api/test", {
        reason: "Not relevant for this project",
      });
      
      const response = await DismissRecommendation(request, {
        params: Promise.resolve({ id: recommendation.id }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      // Verify database updates
      const updatedRecommendation = await db.janitorRecommendation.findUnique({
        where: { id: recommendation.id },
      });
      expect(updatedRecommendation?.status).toBe("DISMISSED");
      expect(updatedRecommendation?.metadata).toMatchObject({
        dismissalReason: "Not relevant for this project",
      });
    });
  });
});