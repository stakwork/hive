import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST as GenerateAI } from "@/app/api/stakwork/ai/generate/route";
import { GET as GetRuns } from "@/app/api/stakwork/runs/route";
import { PATCH as UpdateDecision } from "@/app/api/stakwork/runs/[runId]/decision/route";
import { POST as WebhookHandler } from "@/app/api/webhook/stakwork/response/route";
import { WorkspaceRole, StakworkRunType, StakworkRunDecision } from "@prisma/client";
import { db } from "@/lib/db";
import { stakworkService } from "@/lib/service-factory";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectUnauthorized,
  generateUniqueId,
  generateUniqueSlug,
  createGetRequest,
  createPostRequest,
  createPatchRequest,
  getMockedSession,
  createAuthenticatedPostRequest,
  createAuthenticatedGetRequest,
  createAuthenticatedPatchRequest,
} from "@/__tests__/support/helpers";

vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({
    stakworkRequest: vi.fn(),
  })),
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_AI_GENERATION_WORKFLOW_ID: "123",
  },
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
    STAKWORK_RUN_DECISION: "stakwork-run-decision",
  },
}));

const mockStakworkService = stakworkService as vi.MockedFunction<typeof stakworkService>;

describe("Stakwork Runs API Integration Tests", () => {
  async function createTestWorkspaceWithFeature(role: WorkspaceRole = "OWNER") {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const githubAuth = await tx.gitHubAuth.create({
        data: {
          userId: user.id,
          githubUserId: "123456",
          githubUsername: "testuser",
        },
      });

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
          role,
        },
      });

      const feature = await tx.feature.create({
        data: {
          title: "Test Feature",
          brief: "Test brief description",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      return { user, workspace, feature, githubAuth };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STAKWORK_AI_GENERATION_WORKFLOW_ID = "123";

    const mockStakworkRequest = vi.fn().mockResolvedValue({
      success: true,
      data: { project_id: 12345 },
    });

    mockStakworkService.mockReturnValue({
      stakworkRequest: mockStakworkRequest,
    } as any);
  });

  describe("POST /api/stakwork/ai/generate", () => {
    test("should create AI generation run successfully", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature("ADMIN");
      const request = createAuthenticatedPostRequest("http://localhost/api/test", {
        type: "ARCHITECTURE",
        workspaceId: workspace.id,
        featureId: feature.id,
      }, user);

      const response = await GenerateAI(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.run).toMatchObject({
        type: "ARCHITECTURE",
        workspaceId: workspace.id,
        featureId: feature.id,
        status: "IN_PROGRESS",
        projectId: 12345,
      });

      const runs = await db.stakworkRun.findMany({
        where: { workspaceId: workspace.id },
      });
      expect(runs).toHaveLength(1);
      expect(runs[0].type).toBe(StakworkRunType.ARCHITECTURE);
    });

    test("should create workspace-level generation without featureId", async () => {
      const { user, workspace } = await createTestWorkspaceWithFeature();
      const request = createAuthenticatedPostRequest("http://localhost/api/test", {
        type: "ARCHITECTURE",
        workspaceId: workspace.id,
        featureId: null,
      }, user);

      const response = await GenerateAI(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.run.featureId).toBeNull();
    });

    test("should reject invalid StakworkRunType", async () => {
      const { user, workspace } = await createTestWorkspaceWithFeature();
      const request = createAuthenticatedPostRequest("http://localhost/api/test", {
        type: "INVALID_TYPE",
        workspaceId: workspace.id,
      }, user);

      const response = await GenerateAI(request);

      expect(response.status).toBe(400);
      const responseData = await response.json();
      expect(responseData.error).toBe("Invalid request data");
    });

    test("should reject unauthenticated user", async () => {
      const request = createPostRequest("http://localhost/api/test", {
        type: "ARCHITECTURE",
        workspaceId: "ws-1",
      });

      const response = await GenerateAI(request);
      await expectUnauthorized(response);
    });

    test("should handle Stakwork API failure", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature();
      const mockStakworkRequest = vi.fn().mockRejectedValue(new Error("Stakwork API error"));
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      const request = createAuthenticatedPostRequest("http://localhost/api/test", {
        type: "ARCHITECTURE",
        workspaceId: workspace.id,
        featureId: feature.id,
      }, user);

      const response = await GenerateAI(request);

      expect(response.status).toBe(500);

      const failedRun = await db.stakworkRun.findFirst({
        where: { workspaceId: workspace.id },
      });
      expect(failedRun?.status).toBe("FAILED");
    });
  });

  describe("GET /api/stakwork/runs", () => {
    test("should get all runs for workspace", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature();

      await db.stakworkRun.createMany({
        data: [
          {
            type: StakworkRunType.ARCHITECTURE,
            workspaceId: workspace.id,
            featureId: feature.id,
            status: "COMPLETED",
            webhookUrl: "http://example.com/webhook",
            dataType: "string",
          },
          {
            type: StakworkRunType.ARCHITECTURE,
            workspaceId: workspace.id,
            featureId: null,
            status: "IN_PROGRESS",
            webhookUrl: "http://example.com/webhook",
            dataType: "string",
          },
        ],
      });
      const request = createAuthenticatedGetRequest(
        `http://localhost/api/test?workspaceId=${workspace.id}&limit=10&offset=0`,
        user
      );

      const response = await GetRuns(request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.runs).toHaveLength(2);
      expect(responseData.total).toBe(2);
      expect(responseData.limit).toBe(10);
    });

    test("should filter runs by type", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature();

      await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          webhookUrl: "http://example.com/webhook",
          dataType: "string",
        },
      });
      const request = createAuthenticatedGetRequest(
        `http://localhost/api/test?workspaceId=${workspace.id}&type=ARCHITECTURE&limit=10&offset=0`,
        user
      );

      const response = await GetRuns(request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.runs).toHaveLength(1);
      expect(responseData.runs[0].type).toBe("ARCHITECTURE");
    });

    test("should filter runs by featureId", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature();

      await db.stakworkRun.createMany({
        data: [
          {
            type: StakworkRunType.ARCHITECTURE,
            workspaceId: workspace.id,
            featureId: feature.id,
            status: "COMPLETED",
            webhookUrl: "http://example.com/webhook",
            dataType: "string",
          },
          {
            type: StakworkRunType.ARCHITECTURE,
            workspaceId: workspace.id,
            featureId: null,
            status: "COMPLETED",
            webhookUrl: "http://example.com/webhook",
            dataType: "string",
          },
        ],
      });
      const request = createAuthenticatedGetRequest(
        `http://localhost/api/test?workspaceId=${workspace.id}&featureId=${feature.id}&limit=10&offset=0`,
        user
      );

      const response = await GetRuns(request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.runs).toHaveLength(1);
      expect(responseData.runs[0].featureId).toBe(feature.id);
    });

    test("should reject invalid query parameters", async () => {
      const { user } = await createTestWorkspaceWithFeature();
      const request = createAuthenticatedGetRequest("http://localhost/api/test?workspaceId=invalid-id", user);

      const response = await GetRuns(request);

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/stakwork/ai/generate - REQUIREMENTS", () => {
    test("should create REQUIREMENTS run and trigger Stakwork", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature("ADMIN");

      const request = createAuthenticatedPostRequest(
        "http://localhost/api/stakwork/ai/generate",
        {
          type: "REQUIREMENTS",
          workspaceId: workspace.id,
          featureId: feature.id,
        },
        user
      );

      const response = await GenerateAI(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.run).toBeDefined();
      expect(responseData.run.type).toBe(StakworkRunType.REQUIREMENTS);
      expect(responseData.run.status).toBe("IN_PROGRESS");
      expect(responseData.run.featureId).toBe(feature.id);
      expect(responseData.run.workspaceId).toBe(workspace.id);
    });

    test("should reject REQUIREMENTS run creation without feature access", async () => {
      const { user: userA, workspace: workspaceA, feature: featureA } = 
        await createTestWorkspaceWithFeature("ADMIN");
      const { user: userB } = await createTestWorkspaceWithFeature("ADMIN");

      const request = createAuthenticatedPostRequest(
        "http://localhost/api/stakwork/ai/generate",
        {
          type: "REQUIREMENTS",
          workspaceId: workspaceA.id,
          featureId: featureA.id,
        },
        userB
      );

      const response = await GenerateAI(request);

      // Returns 500 with "Feature not found" when feature doesn't exist in user's workspace
      expect(response.status).toBe(500);
    });
  });

  describe("POST /api/stakwork/ai/generate - USER_STORIES", () => {
    test("should create USER_STORIES run and trigger Stakwork", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature("ADMIN");

      const request = createAuthenticatedPostRequest(
        "http://localhost/api/stakwork/ai/generate",
        {
          type: "USER_STORIES",
          workspaceId: workspace.id,
          featureId: feature.id,
        },
        user
      );

      const response = await GenerateAI(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.run).toBeDefined();
      expect(responseData.run.type).toBe(StakworkRunType.USER_STORIES);
      expect(responseData.run.status).toBe("IN_PROGRESS");
      expect(responseData.run.featureId).toBe(feature.id);
      expect(responseData.run.workspaceId).toBe(workspace.id);
    });

    test("should reject USER_STORIES run creation without feature access", async () => {
      const { user: userA, workspace: workspaceA, feature: featureA } = 
        await createTestWorkspaceWithFeature("ADMIN");
      const { user: userB } = await createTestWorkspaceWithFeature("ADMIN");

      const request = createAuthenticatedPostRequest(
        "http://localhost/api/stakwork/ai/generate",
        {
          type: "USER_STORIES",
          workspaceId: workspaceA.id,
          featureId: featureA.id,
        },
        userB
      );

      const response = await GenerateAI(request);

      // Returns 500 with "Feature not found" when feature doesn't exist in user's workspace
      expect(response.status).toBe(500);
    });
  });

  describe("PATCH /api/stakwork/runs/[runId]/decision - REQUIREMENTS", () => {
    test("should accept REQUIREMENTS run and update feature.requirements", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature("ADMIN");

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.REQUIREMENTS,
          status: "COMPLETED",
          result: "Generated requirements:\\n1. Security\\n2. Performance\\n3. Scalability",
          featureId: feature.id,
          workspaceId: workspace.id,
          projectId: 12345,
          webhookUrl: "https://example.com/webhook",
          dataType: "string",
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost/api/stakwork/runs/${run.id}/decision`,
        {
          decision: "ACCEPTED",
          featureId: feature.id,
        },
        user
      );

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      expect(response.status).toBe(200);

      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      expect(updatedFeature?.requirements).toBe(run.result);
    });

    test("should reject REQUIREMENTS run without updating feature", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature("ADMIN");

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.REQUIREMENTS,
          status: "COMPLETED",
          result: "Generated requirements",
          featureId: feature.id,
          workspaceId: workspace.id,
          projectId: 12345,
          webhookUrl: "https://example.com/webhook",
          dataType: "string",
        },
      });

      const originalRequirements = feature.requirements;

      const request = createAuthenticatedPatchRequest(
        `http://localhost/api/stakwork/runs/${run.id}/decision`,
        {
          decision: "REJECTED",
          featureId: feature.id,
        },
        user
      );

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      expect(response.status).toBe(200);

      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      expect(updatedFeature?.requirements).toBe(originalRequirements);
    });

    test("should create new run when providing feedback on REQUIREMENTS", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature("ADMIN");

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.REQUIREMENTS,
          status: "COMPLETED",
          result: "Initial requirements",
          featureId: feature.id,
          workspaceId: workspace.id,
          projectId: 12345,
          webhookUrl: "https://example.com/webhook",
          dataType: "string",
        },
      });

      const feedback = "Please add more detail about security requirements";

      const request = createAuthenticatedPatchRequest(
        `http://localhost/api/stakwork/runs/${run.id}/decision`,
        {
          decision: "FEEDBACK",
          feedback,
          featureId: feature.id,
        },
        user
      );

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      expect(response.status).toBe(200);

      const updatedRun = await db.stakworkRun.findUnique({
        where: { id: run.id },
      });

      expect(updatedRun?.decision).toBe(StakworkRunDecision.FEEDBACK);
      expect(updatedRun?.feedback).toBe(feedback);
    });
  });

  describe("PATCH /api/stakwork/runs/[runId]/decision - USER_STORIES", () => {
    test("should accept USER_STORIES run and create user stories", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature("ADMIN");

      const userStories = [
        { title: "As a user, I want to login" },
        { title: "As a user, I want to view my profile" },
        { title: "As a user, I want to edit my settings" },
      ];

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.USER_STORIES,
          status: "COMPLETED",
          result: JSON.stringify(userStories),
          featureId: feature.id,
          workspaceId: workspace.id,
          projectId: 12345,
          webhookUrl: "https://example.com/webhook",
          dataType: "json",
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost/api/stakwork/runs/${run.id}/decision`,
        {
          decision: "ACCEPTED",
          featureId: feature.id,
        },
        user
      );

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      expect(response.status).toBe(200);

      const createdStories = await db.userStory.findMany({
        where: { featureId: feature.id },
        orderBy: { createdAt: "asc" },
      });

      expect(createdStories).toHaveLength(userStories.length);
      userStories.forEach((story, index) => {
        expect(createdStories[index].title).toBe(story.title);
      });
    });

    test("should reject USER_STORIES run without creating stories", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature("ADMIN");

      const userStories = [
        { title: "As a user, I want to login" },
      ];

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.USER_STORIES,
          status: "COMPLETED",
          result: JSON.stringify(userStories),
          featureId: feature.id,
          workspaceId: workspace.id,
          projectId: 12345,
          webhookUrl: "https://example.com/webhook",
          dataType: "json",
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost/api/stakwork/runs/${run.id}/decision`,
        {
          decision: "REJECTED",
          featureId: feature.id,
        },
        user
      );

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      expect(response.status).toBe(200);

      const createdStories = await db.userStory.findMany({
        where: { featureId: feature.id },
      });

      expect(createdStories).toHaveLength(0);
    });

    test("should create new run when providing feedback on USER_STORIES", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature("ADMIN");

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.USER_STORIES,
          status: "COMPLETED",
          result: JSON.stringify([{ title: "As a user, I want to login" }]),
          featureId: feature.id,
          workspaceId: workspace.id,
          projectId: 12345,
          webhookUrl: "https://example.com/webhook",
          dataType: "json",
        },
      });

      const feedback = "Please add user stories for admin users";

      const request = createAuthenticatedPatchRequest(
        `http://localhost/api/stakwork/runs/${run.id}/decision`,
        {
          decision: "FEEDBACK",
          feedback,
          featureId: feature.id,
        },
        user
      );

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      expect(response.status).toBe(200);

      const updatedRun = await db.stakworkRun.findUnique({
        where: { id: run.id },
      });

      expect(updatedRun?.decision).toBe(StakworkRunDecision.FEEDBACK);
      expect(updatedRun?.feedback).toBe(feedback);
    });

    test("should handle invalid USER_STORIES JSON gracefully", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature("ADMIN");

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.USER_STORIES,
          status: "COMPLETED",
          result: "invalid json",
          featureId: feature.id,
          workspaceId: workspace.id,
          projectId: 12345,
          webhookUrl: "https://example.com/webhook",
          dataType: "string",
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost/api/stakwork/runs/${run.id}/decision`,
        {
          decision: "ACCEPTED",
          featureId: feature.id,
        },
        user
      );

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      expect(response.status).toBe(500);
    });
  });

  describe("PATCH /api/stakwork/runs/[runId]/decision", () => {
    test("should accept ARCHITECTURE run and update feature", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature();

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          status: "COMPLETED",
          result: "Generated architecture content",
          webhookUrl: "http://example.com/webhook",
          dataType: "string",
        },
      });
      const request = createAuthenticatedPatchRequest("http://localhost/api/test", {
        decision: "ACCEPTED",
        featureId: feature.id,
      }, user);

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.run.decision).toBe("ACCEPTED");
      expect(responseData.run.featureId).toBe(feature.id);

      const updatedRun = await db.stakworkRun.findUnique({
        where: { id: run.id },
      });
      expect(updatedRun?.featureId).toBe(feature.id);

      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });
      expect(updatedFeature?.architecture).toBe("Generated architecture content");
    });

    test("should reject run without updating feature", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature();

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          result: "Generated architecture",
          webhookUrl: "http://example.com/webhook",
          dataType: "string",
        },
      });

      const originalArchitecture = feature.architecture;
      const request = createAuthenticatedPatchRequest("http://localhost/api/test", {
        decision: "REJECTED",
        feedback: "Not good enough",
      }, user);

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.run.decision).toBe("REJECTED");
      expect(responseData.run.feedback).toBe("Not good enough");

      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });
      expect(updatedFeature?.architecture).toBe(originalArchitecture);
    });

    test("should store feedback decision", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature();

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          result: "Generated architecture",
          webhookUrl: "http://example.com/webhook",
          dataType: "string",
        },
      });
      const request = createAuthenticatedPatchRequest("http://localhost/api/test", {
        decision: "FEEDBACK",
        feedback: "Please add more database schema details",
      }, user);

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.run.decision).toBe("FEEDBACK");
      expect(responseData.run.feedback).toBe("Please add more database schema details");
    });

    test("should reject ACCEPTED decision without featureId", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature();

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          status: "COMPLETED",
          result: "Generated architecture content",
          webhookUrl: "http://example.com/webhook",
          dataType: "string",
        },
      });

      const request = createAuthenticatedPatchRequest("http://localhost/api/test", {
        decision: "ACCEPTED",
      }, user);

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      expect(response.status).toBe(400);
      const responseData = await response.json();
      expect(responseData.error).toContain("featureId is required");
    });

    test("should reject ACCEPTED decision with non-existent featureId", async () => {
      const { user, workspace } = await createTestWorkspaceWithFeature();

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          status: "COMPLETED",
          result: "Generated architecture content",
          webhookUrl: "http://example.com/webhook",
          dataType: "string",
        },
      });

      // Use a valid CUID format that doesn't exist in the database
      const nonExistentFeatureId = "clxxxxxxxxxxxxxxxxxxxxxxxxxx";

      const request = createAuthenticatedPatchRequest("http://localhost/api/test", {
        decision: "ACCEPTED",
        featureId: nonExistentFeatureId,
      }, user);

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      expect(response.status).toBe(500);
      const responseData = await response.json();
      expect(responseData.error).toContain("Feature not found");
    });

    test("should reject ACCEPTED decision with featureId from different workspace", async () => {
      const { user, workspace: workspace1 } = await createTestWorkspaceWithFeature();

      // Create second workspace with a feature
      const workspace2 = await db.workspace.create({
        data: {
          name: "Other Workspace",
          slug: "other-workspace",
          ownerId: user.id,
        },
      });

      const feature2 = await db.feature.create({
        data: {
          title: "Other Feature",
          workspace: {
            connect: { id: workspace2.id },
          },
          createdBy: {
            connect: { id: user.id },
          },
          updatedBy: {
            connect: { id: user.id },
          },
        },
      });

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace1.id,
          status: "COMPLETED",
          result: "Generated architecture content",
          webhookUrl: "http://example.com/webhook",
          dataType: "string",
        },
      });

      const request = createAuthenticatedPatchRequest("http://localhost/api/test", {
        decision: "ACCEPTED",
        featureId: feature2.id,
      }, user);

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      expect(response.status).toBe(500);
      const responseData = await response.json();
      expect(responseData.error).toContain("Feature does not belong to the same workspace");
    });

    test("should reject non-member user", async () => {
      const { workspace, feature } = await createTestWorkspaceWithFeature();

      const otherUser = await db.user.create({
        data: {
          id: generateUniqueId("user"),
          email: "other@example.com",
          name: "Other User",
        },
      });

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          webhookUrl: "http://example.com/webhook",
          dataType: "string",
        },
      });

      const request = createAuthenticatedPatchRequest("http://localhost/api/test", {
        decision: "ACCEPTED",
        featureId: feature.id,
      }, otherUser);

      const response = await UpdateDecision(request, {
        params: Promise.resolve({ runId: run.id }),
      });

      expect(response.status).toBe(500);
      const responseData = await response.json();
      expect(responseData.error).toContain("Access denied");
    });
  });

  describe("POST /api/webhook/stakwork/response", () => {
    test("should process webhook and update run status", async () => {
      const { workspace, feature } = await createTestWorkspaceWithFeature();

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "IN_PROGRESS",
          projectId: 12345,
          webhookUrl: "http://example.com/webhook",
          dataType: "string",
        },
      });

      const request = createPostRequest(
        `http://localhost/api/test?type=ARCHITECTURE&workspace_id=${workspace.id}&feature_id=${feature.id}`,
        {
          result: { architecture: "Generated architecture content" },
          project_status: "completed",
          project_id: 12345,
        }
      );

      const response = await WebhookHandler(request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      const updatedRun = await db.stakworkRun.findUnique({
        where: { id: run.id },
      });
      expect(updatedRun?.status).toBe("COMPLETED");
      expect(updatedRun?.result).toBeTruthy();
      expect(updatedRun?.dataType).toBe("json");
    });

    test("should handle webhook with string result", async () => {
      const { workspace } = await createTestWorkspaceWithFeature();

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          status: "IN_PROGRESS",
          projectId: 12345,
          webhookUrl: "http://example.com/webhook",
          dataType: "string",
        },
      });

      const request = createPostRequest(
        `http://localhost/api/test?type=ARCHITECTURE&workspace_id=${workspace.id}`,
        {
          result: "Simple string result",
          project_status: "completed",
          project_id: 12345,
        }
      );

      const response = await WebhookHandler(request);

      expect(response.status).toBe(200);

      const updatedRun = await db.stakworkRun.findUnique({
        where: { id: run.id },
      });
      expect(updatedRun?.dataType).toBe("string");
      expect(updatedRun?.result).toBe("Simple string result");
    });

    test("should handle failed webhook", async () => {
      const { workspace } = await createTestWorkspaceWithFeature();

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          status: "IN_PROGRESS",
          projectId: 12345,
          webhookUrl: "http://example.com/webhook",
          dataType: "string",
        },
      });

      const request = createPostRequest(
        `http://localhost/api/test?type=ARCHITECTURE&workspace_id=${workspace.id}`,
        {
          result: null,
          project_status: "failed",
          project_id: 12345,
        }
      );

      const response = await WebhookHandler(request);

      expect(response.status).toBe(200);

      const updatedRun = await db.stakworkRun.findUnique({
        where: { id: run.id },
      });
      expect(updatedRun?.status).toBe("FAILED");
    });

    test("should handle race condition gracefully", async () => {
      const { workspace } = await createTestWorkspaceWithFeature();

      const run = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          status: "COMPLETED",
          projectId: 12345,
          webhookUrl: "http://example.com/webhook",
          dataType: "string",
        },
      });

      const request = createPostRequest(
        `http://localhost/api/test?type=ARCHITECTURE&workspace_id=${workspace.id}`,
        {
          result: "test",
          project_status: "completed",
          project_id: 12345,
        }
      );

      const response = await WebhookHandler(request);

      expect(response.status).toBe(200);
    });

    test("should reject invalid webhook payload", async () => {
      const { workspace } = await createTestWorkspaceWithFeature();

      const request = createPostRequest(
        `http://localhost/api/test?type=ARCHITECTURE&workspace_id=${workspace.id}`,
        {
          result: "test",
          // This will pass validation but fail to find a matching run
        }
      );

      const response = await WebhookHandler(request);

      // Returns 500 because no matching stakwork run exists
      expect(response.status).toBe(500);
      const responseData = await response.json();
      expect(responseData.error).toContain("StakworkRun not found");
    });
  });

  describe("Latest Run Per Type Logic", () => {
    test("should only consider latest run per type for tab indicators", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature();

      // Create old ARCHITECTURE run with pending decision
      const oldRun = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: null,
          result: "Old architecture",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-01-01"),
        },
      });

      // Create newer ARCHITECTURE run with accepted decision
      const newRun = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: StakworkRunDecision.ACCEPTED,
          result: "New architecture",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-02-01"),
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost/api/stakwork/runs?workspaceId=${workspace.id}&featureId=${feature.id}&status=COMPLETED`,
        user
      );

      const response = await GetRuns(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      // Group by type and check only latest
      const latestPerType = new Map();
      data.runs.forEach((run: any) => {
        if (!latestPerType.has(run.type)) {
          latestPerType.set(run.type, run);
        }
      });

      const architectureLatest = latestPerType.get("ARCHITECTURE");
      expect(architectureLatest.id).toBe(newRun.id);
      expect(architectureLatest.decision).toBe("ACCEPTED");

      // Verify old run exists but should be ignored
      const allArchRuns = data.runs.filter((r: any) => r.type === "ARCHITECTURE");
      expect(allArchRuns.length).toBe(2);
    });

    test("should show pending when latest run has null decision", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature();

      // Create old REQUIREMENTS run with accepted decision
      await db.stakworkRun.create({
        data: {
          type: StakworkRunType.REQUIREMENTS,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: StakworkRunDecision.ACCEPTED,
          result: "Old requirements",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-01-01"),
        },
      });

      // Create newer REQUIREMENTS run with pending decision
      const newRun = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.REQUIREMENTS,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: null,
          result: "New requirements",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-02-01"),
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost/api/stakwork/runs?workspaceId=${workspace.id}&featureId=${feature.id}&status=COMPLETED`,
        user
      );

      const response = await GetRuns(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      const latestPerType = new Map();
      data.runs.forEach((run: any) => {
        if (!latestPerType.has(run.type)) {
          latestPerType.set(run.type, run);
        }
      });

      const requirementsLatest = latestPerType.get("REQUIREMENTS");
      expect(requirementsLatest.id).toBe(newRun.id);
      expect(requirementsLatest.decision).toBeNull();
    });

    test("should handle mixed states across different types", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature();

      // ARCHITECTURE: latest is accepted
      await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: null,
          result: "Old",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-01-01"),
        },
      });
      await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: StakworkRunDecision.ACCEPTED,
          result: "New",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-02-01"),
        },
      });

      // REQUIREMENTS: latest is pending
      await db.stakworkRun.create({
        data: {
          type: StakworkRunType.REQUIREMENTS,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: StakworkRunDecision.ACCEPTED,
          result: "Old",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-01-01"),
        },
      });
      await db.stakworkRun.create({
        data: {
          type: StakworkRunType.REQUIREMENTS,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: null,
          result: "New",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-02-01"),
        },
      });

      // TASK_GENERATION: multiple old pending, latest is accepted
      await db.stakworkRun.create({
        data: {
          type: StakworkRunType.TASK_GENERATION,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: null,
          result: "Old 1",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-01-01"),
        },
      });
      await db.stakworkRun.create({
        data: {
          type: StakworkRunType.TASK_GENERATION,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: null,
          result: "Old 2",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-01-15"),
        },
      });
      await db.stakworkRun.create({
        data: {
          type: StakworkRunType.TASK_GENERATION,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: StakworkRunDecision.ACCEPTED,
          result: "New",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-02-01"),
        },
      });

      // USER_STORIES: latest is pending
      await db.stakworkRun.create({
        data: {
          type: StakworkRunType.USER_STORIES,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: null,
          result: "Latest",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-02-01"),
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost/api/stakwork/runs?workspaceId=${workspace.id}&featureId=${feature.id}&status=COMPLETED`,
        user
      );

      const response = await GetRuns(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      // Compute pending types using same logic as production
      const latestPerType = new Map();
      data.runs.forEach((run: any) => {
        if (!latestPerType.has(run.type)) {
          latestPerType.set(run.type, run);
        }
      });

      const pendingTypes = Array.from(latestPerType.values())
        .filter((run: any) => run.decision === null)
        .map((run: any) => run.type);

      // Only REQUIREMENTS and USER_STORIES should be pending
      expect(pendingTypes).toContain("REQUIREMENTS");
      expect(pendingTypes).toContain("USER_STORIES");
      expect(pendingTypes).not.toContain("ARCHITECTURE");
      expect(pendingTypes).not.toContain("TASK_GENERATION");
      expect(pendingTypes.length).toBe(2);
    });

    test("should handle rejected decisions same as accepted", async () => {
      const { user, workspace, feature } = await createTestWorkspaceWithFeature();

      // Old pending run
      await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: null,
          result: "Old",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-01-01"),
        },
      });

      // New rejected run
      const newRun = await db.stakworkRun.create({
        data: {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "COMPLETED",
          decision: StakworkRunDecision.REJECTED,
          result: "New",
          dataType: "string",
          webhookUrl: "https://example.com/webhook",
          createdAt: new Date("2024-02-01"),
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost/api/stakwork/runs?workspaceId=${workspace.id}&featureId=${feature.id}&status=COMPLETED`,
        user
      );

      const response = await GetRuns(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      const latestPerType = new Map();
      data.runs.forEach((run: any) => {
        if (!latestPerType.has(run.type)) {
          latestPerType.set(run.type, run);
        }
      });

      const architectureLatest = latestPerType.get("ARCHITECTURE");
      expect(architectureLatest.id).toBe(newRun.id);
      expect(architectureLatest.decision).toBe("REJECTED");

      // Should NOT be pending
      const pendingTypes = Array.from(latestPerType.values())
        .filter((run: any) => run.decision === null)
        .map((run: any) => run.type);
      
      expect(pendingTypes).not.toContain("ARCHITECTURE");
    });
  });
});
