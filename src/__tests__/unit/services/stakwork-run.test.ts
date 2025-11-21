import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  createStakworkRun,
  processStakworkRunWebhook,
  getStakworkRuns,
  updateStakworkRunDecision,
} from "@/services/stakwork-run";
import { db } from "@/lib/db";
import { stakworkService } from "@/lib/service-factory";
import { pusherServer } from "@/lib/pusher";
import { FieldEncryptionService } from "@/lib/encryption/field-encryption";
import { StakworkRunType, StakworkRunDecision, WorkflowStatus } from "@prisma/client";

vi.mock("@/lib/db");
vi.mock("@/lib/service-factory");
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
    STAKWORK_RUN_DECISION: "stakwork-run-decision",
  },
}));
vi.mock("@/lib/ai/utils", () => ({
  buildFeatureContext: vi.fn((feature: any) => ({
    title: feature.title,
    brief: feature.brief || "",
    workspaceDesc: feature.workspace?.description || "",
    personasText: "",
    userStoriesText: feature.userStories?.map((us: any) => us.title).join("\n") || "",
    requirementsText: "",
    architectureText: feature.architecture || "",
  })),
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((field: string, value: any) => `decrypted-${field}`),
    })),
  },
}));

vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_AI_GENERATION_WORKFLOW_ID: "123",
  },
}));

const mockedDb = vi.mocked(db);
const mockedStakworkService = vi.mocked(stakworkService);
const mockedPusherServer = vi.mocked(pusherServer);

describe("Stakwork Run Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createStakworkRun", () => {
    test("should create stakwork run successfully for ARCHITECTURE type", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "OWNER" }],
        swarm: {
          swarmUrl: "https://swarm.example.com",
          swarmApiKey: "encrypted-key",
          swarmSecretAlias: "secret-alias",
          poolName: "test-pool",
          id: "swarm-1",
        },
        sourceControlOrg: {
          tokens: [{ token: "encrypted-pat" }],
        },
        repositories: [{ repositoryUrl: "https://github.com/test/repo" }],
      };

      const mockUser = {
        id: "user-1",
        githubAuth: { githubUsername: "testuser" },
      };

      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        architecture: "Existing architecture",
        userStories: [{ title: "User story 1" }, { title: "User story 2" }],
        workspace: { description: "Test workspace" },
      };

      const mockRun = {
        id: "run-1",
        type: StakworkRunType.ARCHITECTURE,
        workspaceId: "ws-1",
        featureId: "feature-1",
        status: WorkflowStatus.PENDING,
        webhookUrl: "http://example.com/webhook",
        dataType: "json",
      };

      const mockRunUpdated = {
        ...mockRun,
        projectId: 12345,
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue(mockUser);
      mockedDb.feature.findFirst = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue(mockRunUpdated);

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        data: { project_id: 12345 },
      });
      mockedStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      const result = await createStakworkRun(
        {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: "ws-1",
          featureId: "feature-1",
        },
        "user-1",
      );

      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { id: "ws-1" },
        select: expect.any(Object),
      });
      expect(db.feature.findFirst).toHaveBeenCalledWith({
        where: {
          id: "feature-1",
          workspaceId: "ws-1",
          deleted: false,
        },
        include: expect.any(Object),
      });
      expect(db.stakworkRun.create).toHaveBeenCalled();
      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          name: expect.stringContaining("ai-gen-architecture"),
          workflow_id: 123,
          workflow_params: expect.objectContaining({
            set_var: expect.objectContaining({
              attributes: expect.objectContaining({
                vars: expect.objectContaining({
                  runId: "run-1",
                  type: StakworkRunType.ARCHITECTURE,
                  workspaceId: "ws-1",
                  featureId: "feature-1",
                  webhookUrl: expect.stringContaining("/api/webhook/stakwork/response"),
                  repo_url: "https://github.com/test/repo",
                  username: "testuser",
                  pat: "decrypted-access_token",
                  swarmUrl: "https://swarm.example.com",
                  swarmApiKey: "decrypted-swarmApiKey",
                  swarmSecretAlias: "secret-alias",
                  poolName: "test-pool",
                  featureTitle: "Test Feature",
                  featureBrief: "Test brief",
                  workspaceDesc: "Test workspace",
                  personas: "",
                  userStories: expect.stringContaining("User story"),
                  requirements: "",
                  architecture: "Existing architecture",
                }),
              }),
            }),
          }),
        }),
      );
      expect(db.stakworkRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: {
          projectId: 12345,
          status: WorkflowStatus.IN_PROGRESS,
        },
      });
      expect(result.projectId).toBe(12345);
      expect(result.status).toBe(WorkflowStatus.IN_PROGRESS);
    });

    test("should throw error when workspace not found", async () => {
      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(null);

      await expect(
        createStakworkRun(
          {
            type: StakworkRunType.ARCHITECTURE,
            workspaceId: "non-existent",
            featureId: "feature-1",
          },
          "user-1",
        ),
      ).rejects.toThrow("Workspace not found");
    });

    test("should throw error when feature not found", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "OWNER" }],
        swarm: null,
        sourceControlOrg: null,
        repositories: [],
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue({ id: "user-1" });
      mockedDb.feature.findFirst = vi.fn().mockResolvedValue(null);

      await expect(
        createStakworkRun(
          {
            type: StakworkRunType.ARCHITECTURE,
            workspaceId: "ws-1",
            featureId: "non-existent",
          },
          "user-1",
        ),
      ).rejects.toThrow("Feature not found");
    });

    test("should handle Stakwork API failure and mark run as FAILED", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "OWNER" }],
        swarm: null,
        sourceControlOrg: null,
        repositories: [],
      };

      const mockRun = {
        id: "run-1",
        type: StakworkRunType.ARCHITECTURE,
        workspaceId: "ws-1",
        status: WorkflowStatus.PENDING,
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue({ id: "user-1" });
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({});

      const mockStakworkRequest = vi.fn().mockRejectedValue(new Error("Stakwork API error"));
      mockedStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      await expect(
        createStakworkRun(
          {
            type: StakworkRunType.ARCHITECTURE,
            workspaceId: "ws-1",
            featureId: null,
          },
          "user-1",
        ),
      ).rejects.toThrow("Stakwork API error");

      // Should be called twice: once for webhookUrl, once for FAILED status
      expect(db.stakworkRun.update).toHaveBeenCalledTimes(2);
      expect(db.stakworkRun.update).toHaveBeenNthCalledWith(1, {
        where: { id: "run-1" },
        data: expect.objectContaining({ webhookUrl: expect.any(String) }),
      });
      expect(db.stakworkRun.update).toHaveBeenNthCalledWith(2, {
        where: { id: "run-1" },
        data: { status: WorkflowStatus.FAILED },
      });
    });

    test("should work without feature for workspace-level generation", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "OWNER" }],
        swarm: null,
        sourceControlOrg: null,
        repositories: [],
      };

      const mockRun = {
        id: "run-1",
        type: StakworkRunType.ARCHITECTURE,
        workspaceId: "ws-1",
        featureId: null,
        status: WorkflowStatus.PENDING,
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue({ id: "user-1" });
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({
        ...mockRun,
        projectId: 12345,
        status: WorkflowStatus.IN_PROGRESS,
      });

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        data: { project_id: 12345 },
      });
      mockedStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      const result = await createStakworkRun(
        {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: "ws-1",
          featureId: null,
        },
        "user-1",
      );

      expect(result.projectId).toBe(12345);
      expect(result.featureId).toBeNull();
    });
  });

  describe("processStakworkRunWebhook", () => {
    test("should process webhook and update run status", async () => {
      const mockRun = {
        id: "run-1",
        type: StakworkRunType.ARCHITECTURE,
        featureId: "feature-1",
        workspace: { slug: "test-workspace" },
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const result = await processStakworkRunWebhook(
        {
          result: { architecture: "Generated architecture" },
          project_status: "completed",
          project_id: 12345,
        },
        {
          type: "ARCHITECTURE",
          workspace_id: "ws-1",
          feature_id: "feature-1",
        },
      );

      expect(db.stakworkRun.updateMany).toHaveBeenCalledWith({
        where: {
          id: "run-1",
          status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
        },
        data: {
          status: WorkflowStatus.COMPLETED,
          result: JSON.stringify({ architecture: "Generated architecture" }),
          dataType: "json",
          updatedAt: expect.any(Date),
        },
      });

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        "workspace-test-workspace",
        "stakwork-run-update",
        expect.objectContaining({
          runId: "run-1",
          type: StakworkRunType.ARCHITECTURE,
          status: WorkflowStatus.COMPLETED,
          featureId: "feature-1",
        }),
      );

      expect(result.runId).toBe("run-1");
      expect(result.status).toBe(WorkflowStatus.COMPLETED);
    });

    test("should handle race condition when run already updated", async () => {
      const mockRun = {
        id: "run-1",
        type: StakworkRunType.ARCHITECTURE,
        workspace: { slug: "test-workspace" },
        status: WorkflowStatus.COMPLETED,
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.updateMany = vi.fn().mockResolvedValue({ count: 0 });

      const result = await processStakworkRunWebhook(
        {
          result: "test result",
          project_status: "completed",
        },
        {
          type: "ARCHITECTURE",
          workspace_id: "ws-1",
        },
      );

      expect(result.runId).toBe("run-1");
      expect(result.status).toBe(WorkflowStatus.COMPLETED);
      expect(pusherServer.trigger).not.toHaveBeenCalled();
    });

    test("should throw error when run not found", async () => {
      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(null);

      await expect(
        processStakworkRunWebhook(
          {
            result: "test",
            project_id: 12345,
          },
          {
            type: "ARCHITECTURE",
            workspace_id: "ws-1",
          },
        ),
      ).rejects.toThrow("StakworkRun not found");
    });

    test("should handle different data types correctly", async () => {
      const mockRun = {
        id: "run-1",
        workspace: { slug: "test-workspace" },
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      // Test string result
      await processStakworkRunWebhook({ result: "string result" }, { type: "ARCHITECTURE", workspace_id: "ws-1" });
      expect(db.stakworkRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dataType: "string",
            result: "string result",
          }),
        }),
      );

      // Test array result
      await processStakworkRunWebhook({ result: ["item1", "item2"] }, { type: "ARCHITECTURE", workspace_id: "ws-1" });
      expect(db.stakworkRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dataType: "array",
            result: JSON.stringify(["item1", "item2"]),
          }),
        }),
      );

      // Test null result
      await processStakworkRunWebhook({ result: null }, { type: "ARCHITECTURE", workspace_id: "ws-1" });
      expect(db.stakworkRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dataType: "null",
            result: null,
          }),
        }),
      );
    });

    test("should handle Pusher failure gracefully", async () => {
      const mockRun = {
        id: "run-1",
        workspace: { slug: "test-workspace" },
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockedPusherServer.trigger = vi.fn().mockRejectedValue(new Error("Pusher error"));

      const result = await processStakworkRunWebhook(
        { result: "test" },
        { type: "ARCHITECTURE", workspace_id: "ws-1" },
      );

      expect(result.runId).toBe("run-1");
    });
  });

  describe("getStakworkRuns", () => {
    test("should return paginated stakwork runs", async () => {
      const mockWorkspace = {
        id: "ws-1",
        members: [{ userId: "user-1" }],
      };

      const mockRuns = [
        {
          id: "run-1",
          type: StakworkRunType.ARCHITECTURE,
          status: WorkflowStatus.COMPLETED,
          feature: { id: "feature-1", title: "Test Feature" },
        },
        {
          id: "run-2",
          type: StakworkRunType.ARCHITECTURE,
          status: WorkflowStatus.IN_PROGRESS,
          feature: null,
        },
      ];

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.stakworkRun.count = vi.fn().mockResolvedValue(2);
      mockedDb.stakworkRun.findMany = vi.fn().mockResolvedValue(mockRuns);

      const result = await getStakworkRuns(
        {
          workspaceId: "ws-1",
          limit: 10,
          offset: 0,
        },
        "user-1",
      );

      expect(result.runs).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });

    test("should filter runs by type and status", async () => {
      const mockWorkspace = {
        id: "ws-1",
        members: [{ userId: "user-1" }],
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.stakworkRun.count = vi.fn().mockResolvedValue(1);
      mockedDb.stakworkRun.findMany = vi.fn().mockResolvedValue([]);

      await getStakworkRuns(
        {
          workspaceId: "ws-1",
          type: StakworkRunType.ARCHITECTURE,
          status: WorkflowStatus.COMPLETED,
          limit: 10,
          offset: 0,
        },
        "user-1",
      );

      expect(db.stakworkRun.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: "ws-1",
          type: StakworkRunType.ARCHITECTURE,
          status: WorkflowStatus.COMPLETED,
        },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 10,
        include: expect.any(Object),
      });
    });

    test("should throw error when workspace not found", async () => {
      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(null);

      await expect(getStakworkRuns({ workspaceId: "non-existent", limit: 10, offset: 0 }, "user-1")).rejects.toThrow(
        "Workspace not found",
      );
    });

    test("should throw error when user not a member", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "different-user",
        members: [],
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);

      await expect(getStakworkRuns({ workspaceId: "ws-1", limit: 10, offset: 0 }, "user-1")).rejects.toThrow(
        "Access denied",
      );
    });
  });

  describe("updateStakworkRunDecision", () => {
    test("should accept ARCHITECTURE run and update feature.architecture", async () => {
      const mockRun = {
        id: "run-1",
        type: StakworkRunType.ARCHITECTURE,
        featureId: "feature-1",
        result: "Generated architecture content",
        workspace: {
          slug: "test-workspace",
          members: [{ userId: "user-1" }],
        },
      };

      const updatedRun = {
        ...mockRun,
        decision: StakworkRunDecision.ACCEPTED,
        feedback: null,
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue(updatedRun);
      mockedDb.feature.update = vi.fn().mockResolvedValue({});
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const result = await updateStakworkRunDecision("run-1", "user-1", {
        decision: StakworkRunDecision.ACCEPTED,
      });

      expect(db.stakworkRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: {
          decision: StakworkRunDecision.ACCEPTED,
          feedback: null,
        },
      });

      expect(db.feature.update).toHaveBeenCalledWith({
        where: { id: "feature-1" },
        data: {
          architecture: "Generated architecture content",
        },
      });

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        "workspace-test-workspace",
        "stakwork-run-decision",
        expect.objectContaining({
          runId: "run-1",
          decision: StakworkRunDecision.ACCEPTED,
        }),
      );

      expect(result.decision).toBe(StakworkRunDecision.ACCEPTED);
    });

    test("should reject run without updating feature", async () => {
      const mockRun = {
        id: "run-1",
        type: StakworkRunType.ARCHITECTURE,
        featureId: "feature-1",
        result: "Generated architecture",
        workspace: {
          slug: "test-workspace",
          members: [{ userId: "user-1" }],
        },
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({
        ...mockRun,
        decision: StakworkRunDecision.REJECTED,
        feedback: "Not good enough",
      });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      await updateStakworkRunDecision("run-1", "user-1", {
        decision: StakworkRunDecision.REJECTED,
        feedback: "Not good enough",
      });

      expect(db.feature.update).not.toHaveBeenCalled();
    });

    test("should store feedback with decision", async () => {
      const mockRun = {
        id: "run-1",
        workspace: {
          slug: "test-workspace",
          members: [{ userId: "user-1" }],
        },
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({});
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      await updateStakworkRunDecision("run-1", "user-1", {
        decision: StakworkRunDecision.FEEDBACK,
        feedback: "Please add more details",
      });

      expect(db.stakworkRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: {
          decision: StakworkRunDecision.FEEDBACK,
          feedback: "Please add more details",
        },
      });
    });

    test("should throw error when run not found", async () => {
      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(null);

      await expect(
        updateStakworkRunDecision("non-existent", "user-1", {
          decision: StakworkRunDecision.ACCEPTED,
        }),
      ).rejects.toThrow("StakworkRun not found");
    });

    test("should throw error when user not a member", async () => {
      const mockRun = {
        id: "run-1",
        workspace: {
          slug: "test-workspace",
          ownerId: "different-user",
          members: [],
        },
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);

      await expect(
        updateStakworkRunDecision("run-1", "user-1", {
          decision: StakworkRunDecision.ACCEPTED,
        }),
      ).rejects.toThrow("Access denied");
    });

    test("should handle Pusher failure gracefully", async () => {
      const mockRun = {
        id: "run-1",
        workspace: {
          slug: "test-workspace",
          members: [{ userId: "user-1" }],
        },
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({});
      mockedPusherServer.trigger = vi.fn().mockRejectedValue(new Error("Pusher error"));

      const result = await updateStakworkRunDecision("run-1", "user-1", {
        decision: StakworkRunDecision.ACCEPTED,
      });

      expect(result).toBeDefined();
    });
  });
});
