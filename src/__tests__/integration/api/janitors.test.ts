import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { GET as GetConfig, PUT as UpdateConfig } from "@/app/api/workspaces/[slug]/janitors/config/route";
import { POST as TriggerRun } from "@/app/api/workspaces/[slug]/janitors/[type]/run/route";
import { GET as GetRuns } from "@/app/api/workspaces/[slug]/janitors/runs/route";
import { GET as GetRecommendations } from "@/app/api/workspaces/[slug]/janitors/recommendations/route";
import { POST as AcceptRecommendation } from "@/app/api/janitors/recommendations/[id]/accept/route";
import { POST as DismissRecommendation } from "@/app/api/janitors/recommendations/[id]/dismiss/route";
import { POST as WebhookHandler } from "@/app/api/janitors/webhook/route";
import { WorkspaceRole, JanitorType } from "@prisma/client";
import { db } from "@/lib/db";

// Mock NextAuth - only external dependency
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;

describe("Janitor API Integration Tests", () => {
  async function createTestWorkspaceWithUser(role: WorkspaceRole = "OWNER") {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: `user-${Date.now()}-${Math.random()}`,
          email: `user-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: `Test Workspace ${Date.now()}`,
          slug: `test-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          ownerId: user.id,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: role,
        },
      });

      return { user, workspace };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Janitor Configuration", () => {
    test("GET /api/workspaces/[slug]/janitors/config - should get janitor config", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("OWNER");
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "GET",
      });
      
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
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "PUT",
        body: JSON.stringify({
          unitTestsEnabled: true,
          integrationTestsEnabled: false,
        }),
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
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "PUT",
        body: JSON.stringify({ unitTestsEnabled: true }),
      });
      
      const response = await UpdateConfig(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(403);
    });

    test("GET /api/workspaces/[slug]/janitors/config - should reject unauthenticated user", async () => {
      const { workspace } = await createTestWorkspaceWithUser();
      
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest("http://localhost/api/test", {
        method: "GET",
      });
      
      const response = await GetConfig(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(401);
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
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
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
        status: "PENDING",
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
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
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
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
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

    test("POST /api/workspaces/[slug]/janitors/[type]/run - should prevent concurrent runs", async () => {
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
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ 
          slug: workspace.slug, 
          type: "unit_tests" 
        }),
      });

      expect(response.status).toBe(409);
      const responseData = await response.json();
      expect(responseData.error).toContain("already in progress");
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
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const url = new URL(`http://localhost/api/test?limit=10&page=1`);
      const request = new NextRequest(url, { method: "GET" });
      
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
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const url = new URL(`http://localhost/api/test?type=UNIT_TESTS`);
      const request = new NextRequest(url, { method: "GET" });
      
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

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify(webhookPayload),
      });
      
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

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify(webhookPayload),
      });
      
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

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify(webhookPayload),
      });
      
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
            title: "Add unit tests for UserService",
            description: "UserService needs test coverage",
            priority: "HIGH",
            status: "PENDING",
          },
          {
            janitorRunId: janitorRun.id,
            title: "Add integration tests", 
            description: "Missing integration test coverage",
            priority: "MEDIUM",
            status: "ACCEPTED",
            acceptedById: user.id,
            acceptedAt: new Date(),
          },
        ],
      });
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const url = new URL(`http://localhost/api/test?limit=10&page=1`);
      const request = new NextRequest(url, { method: "GET" });
      
      const response = await GetRecommendations(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData).toHaveProperty("recommendations");
      expect(responseData).toHaveProperty("pagination");
      expect(responseData.recommendations).toHaveLength(2);
      expect(responseData.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: 2,
      });

      // Verify recommendation data structure
      const pendingRec = responseData.recommendations.find((r: any) => r.status === "PENDING");
      const acceptedRec = responseData.recommendations.find((r: any) => r.status === "ACCEPTED");
      
      expect(pendingRec).toMatchObject({
        title: "Add unit tests for UserService",
        priority: "HIGH",
        status: "PENDING",
      });

      expect(acceptedRec).toMatchObject({
        title: "Add integration tests",
        priority: "MEDIUM", 
        status: "ACCEPTED",
        acceptedBy: {
          id: user.id,
          email: user.email,
        },
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
            title: "Pending recommendation",
            description: "This is pending",
            priority: "HIGH",
            status: "PENDING",
          },
          {
            janitorRunId: janitorRun.id,
            title: "Accepted recommendation",
            description: "This is accepted",
            priority: "MEDIUM",
            status: "ACCEPTED",
            acceptedById: user.id,
            acceptedAt: new Date(),
          },
        ],
      });
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const url = new URL(`http://localhost/api/test?status=PENDING`);
      const request = new NextRequest(url, { method: "GET" });
      
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
            title: "High priority recommendation",
            description: "This is high priority",
            priority: "HIGH",
            status: "PENDING",
          },
          {
            janitorRunId: janitorRun.id,
            title: "Low priority recommendation",
            description: "This is low priority",
            priority: "LOW",
            status: "PENDING",
          },
        ],
      });
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const url = new URL(`http://localhost/api/test?priority=HIGH`);
      const request = new NextRequest(url, { method: "GET" });
      
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
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const url = new URL(`http://localhost/api/test`);
      const request = new NextRequest(url, { method: "GET" });
      
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
      
      mockGetServerSession.mockResolvedValue(null);

      const url = new URL(`http://localhost/api/test`);
      const request = new NextRequest(url, { method: "GET" });
      
      const response = await GetRecommendations(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(401);
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
          title: "Add unit tests",
          description: "Need more test coverage",
          priority: "HIGH",
          status: "PENDING",
        },
      });
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({}),
      });
      
      const response = await AcceptRecommendation(request, {
        params: Promise.resolve({ id: recommendation.id }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.task).toHaveProperty("id");
      expect(responseData.task.title).toBe("Add unit tests");

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
          title: "Add unit tests",
          description: "Need more test coverage",
          priority: "LOW",
          status: "PENDING",
        },
      });
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          reason: "Not relevant for this project",
        }),
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