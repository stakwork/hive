import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  createStakworkRun,
  processStakworkRunWebhook,
  getStakworkRuns,
  updateStakworkRunDecision,
  stopStakworkRun,
} from "@/services/stakwork-run";
import { db } from "@/lib/db";
import { stakworkService } from "@/lib/service-factory";
import { pusherServer } from "@/lib/pusher";
import { FieldEncryptionService } from "@/lib/encryption/field-encryption";
import { StakworkRunType, StakworkRunDecision, WorkflowStatus } from "@prisma/client";
import { config } from "@/config/env";

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
  buildFeatureContext: vi.fn((feature: any) => {
    // Extract existing tasks from all phases
    const existingTasks = feature.phases?.flatMap((phase: any) => phase.tasks || []) || [];
    const tasksText = existingTasks.length > 0
      ? `\n\nExisting Tasks:\n${existingTasks.map((t: any) => {
          let taskLine = `- ${t.title} (${t.status}, ${t.priority})`;
          if (t.description) {
            taskLine += `\n  Description: ${t.description}`;
          }
          return taskLine;
        }).join('\n')}`
      : null;

    return {
      title: feature.title,
      brief: feature.brief || "",
      workspaceDesc: feature.workspace?.description || "",
      personasText: "",
      userStoriesText: feature.userStories?.map((us: any) => us.title).join("\n") || "",
      requirementsText: "",
      architectureText: feature.architecture || "",
      tasksText,
    };
  }),
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((field: string, value: any) => `decrypted-${field}`),
    })),
  },
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_AI_GENERATION_WORKFLOW_ID: "123",
    STAKWORK_API_KEY: "test-stakwork-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    POOL_MANAGER_API_KEY: "test-pool-key",
    POOL_MANAGER_BASE_URL: "https://workspaces.sphinx.chat/api",
  },
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    POOL_MANAGER_BASE_URL: "https://workspaces.sphinx.chat/api",
    API_TIMEOUT: 10000,
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
        "user-1"
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
        })
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
          "user-1"
        )
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
          "user-1"
        )
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
          "user-1"
        )
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
        "user-1"
      );

      expect(result.projectId).toBe(12345);
      expect(result.featureId).toBeNull();
    });

    test("should create USER_STORIES run with correct feature context", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "OWNER" }],
        swarm: null,
        sourceControlOrg: null,
        repositories: [],
      };

      const mockUser = {
        id: "user-1",
        githubAuth: { githubUsername: "testuser" },
      };

      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        userStories: [],
        workspace: { description: "Test workspace" },
        phases: [],
      };

      const mockRun = {
        id: "run-1",
        type: StakworkRunType.USER_STORIES,
        workspaceId: "ws-1",
        featureId: "feature-1",
        status: WorkflowStatus.PENDING,
        webhookUrl: "",
      };

      const mockUpdatedRun = {
        ...mockRun,
        projectId: 12345,
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue(mockUser);
      mockedDb.feature.findFirst = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn()
        .mockResolvedValueOnce({ ...mockRun, webhookUrl: "http://test.com/webhook" })
        .mockResolvedValueOnce(mockUpdatedRun);

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        success: true,
        data: { project_id: 12345 },
      });
      mockedStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      const result = await createStakworkRun(
        {
          type: StakworkRunType.USER_STORIES,
          workspaceId: "ws-1",
          featureId: "feature-1",
        },
        "user-1"
      );

      expect(result.type).toBe(StakworkRunType.USER_STORIES);
      expect(result.featureId).toBe("feature-1");
      expect(result.projectId).toBe(12345);
    });

    test("should create REQUIREMENTS run with correct feature context", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "OWNER" }],
        swarm: null,
        sourceControlOrg: null,
        repositories: [],
      };

      const mockUser = {
        id: "user-1",
        githubAuth: { githubUsername: "testuser" },
      };

      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        userStories: [],
        workspace: { description: "Test workspace" },
        phases: [],
      };

      const mockRun = {
        id: "run-1",
        type: StakworkRunType.REQUIREMENTS,
        workspaceId: "ws-1",
        featureId: "feature-1",
        status: WorkflowStatus.PENDING,
        webhookUrl: "",
      };

      const mockUpdatedRun = {
        ...mockRun,
        projectId: 12345,
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue(mockUser);
      mockedDb.feature.findFirst = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn()
        .mockResolvedValueOnce({ ...mockRun, webhookUrl: "http://test.com/webhook" })
        .mockResolvedValueOnce(mockUpdatedRun);

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        success: true,
        data: { project_id: 12345 },
      });
      mockedStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      const result = await createStakworkRun(
        {
          type: StakworkRunType.REQUIREMENTS,
          workspaceId: "ws-1",
          featureId: "feature-1",
        },
        "user-1"
      );

      expect(result.type).toBe(StakworkRunType.REQUIREMENTS);
      expect(result.featureId).toBe("feature-1");
      expect(result.projectId).toBe(12345);
    });

    test("should create TASK_GENERATION run with feature context including existing tasks", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "OWNER" }],
        swarm: null,
        sourceControlOrg: null,
        repositories: [],
      };

      const mockUser = {
        id: "user-1",
        githubAuth: { githubUsername: "testuser" },
      };

      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        userStories: [{ title: "User story 1" }],
        workspace: { description: "Test workspace" },
        phases: [
          {
            tasks: [
              { title: "Task 1", description: "Desc 1", status: "TODO", priority: "HIGH" },
              { title: "Task 2", description: null, status: "IN_PROGRESS", priority: "MEDIUM" },
            ],
          },
        ],
      };

      const mockRun = {
        id: "run-1",
        type: StakworkRunType.TASK_GENERATION,
        workspaceId: "ws-1",
        featureId: "feature-1",
        status: WorkflowStatus.PENDING,
        webhookUrl: "",
      };

      const mockUpdatedRun = {
        ...mockRun,
        projectId: 12345,
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue(mockUser);
      mockedDb.feature.findFirst = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn()
        .mockResolvedValueOnce({ ...mockRun, webhookUrl: "http://test.com/webhook" })
        .mockResolvedValueOnce(mockUpdatedRun);

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        success: true,
        data: { project_id: 12345 },
      });
      mockedStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      const result = await createStakworkRun(
        {
          type: StakworkRunType.TASK_GENERATION,
          workspaceId: "ws-1",
          featureId: "feature-1",
        },
        "user-1"
      );

      expect(result.type).toBe(StakworkRunType.TASK_GENERATION);
      expect(result.featureId).toBe("feature-1");
      expect(result.projectId).toBe(12345);

      // Verify feature context includes existing tasks
      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          workflow_params: expect.objectContaining({
            set_var: expect.objectContaining({
              attributes: expect.objectContaining({
                vars: expect.objectContaining({
                  existingTasks: expect.stringContaining("Task 1"),
                }),
              }),
            }),
          }),
        })
      );
    });

    test("should throw error when workspace is deleted", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: true,
        members: [{ role: "OWNER" }],
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);

      await expect(
        createStakworkRun(
          {
            type: StakworkRunType.ARCHITECTURE,
            workspaceId: "ws-1",
            featureId: null,
          },
          "user-1"
        )
      ).rejects.toThrow("Workspace not found");
    });

    test("should throw error when user is not owner or member", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "different-user",
        deleted: false,
        members: [], // User is not a member
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);

      await expect(
        createStakworkRun(
          {
            type: StakworkRunType.ARCHITECTURE,
            workspaceId: "ws-1",
            featureId: null,
          },
          "user-1"
        )
      ).rejects.toThrow("Access denied");
    });

    test("should throw error when feature belongs to different workspace", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "OWNER" }],
        swarm: null,
        sourceControlOrg: null,
        repositories: [],
      };

      const mockUser = {
        id: "user-1",
        githubAuth: { githubUsername: "testuser" },
      };

      // Feature belongs to different workspace
      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue(mockUser);
      mockedDb.feature.findFirst = vi.fn().mockResolvedValue(null); // Not found in this workspace

      await expect(
        createStakworkRun(
          {
            type: StakworkRunType.ARCHITECTURE,
            workspaceId: "ws-1",
            featureId: "feature-from-different-workspace",
          },
          "user-1"
        )
      ).rejects.toThrow("Feature not found");
    });

    test("should throw error when STAKWORK_AI_GENERATION_WORKFLOW_ID is not configured", async () => {
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
      mockedDb.stakworkRun.update = vi.fn()
        .mockResolvedValueOnce({ ...mockRun, webhookUrl: "http://test.com/webhook" })
        .mockResolvedValue({});

      // Temporarily clear the config
      const originalConfig = config.STAKWORK_AI_GENERATION_WORKFLOW_ID;
      (config as any).STAKWORK_AI_GENERATION_WORKFLOW_ID = undefined;

      await expect(
        createStakworkRun(
          {
            type: StakworkRunType.ARCHITECTURE,
            workspaceId: "ws-1",
            featureId: null,
          },
          "user-1"
        )
      ).rejects.toThrow("STAKWORK_AI_GENERATION_WORKFLOW_ID not configured");

      // Restore config
      (config as any).STAKWORK_AI_GENERATION_WORKFLOW_ID = originalConfig;

      // Should mark run as FAILED
      expect(db.stakworkRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { status: WorkflowStatus.FAILED },
      });
    });

    test("should throw error when Stakwork API returns response without projectId", async () => {
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
      mockedDb.stakworkRun.update = vi.fn()
        .mockResolvedValueOnce({ ...mockRun, webhookUrl: "http://test.com/webhook" })
        .mockResolvedValue({});

      // Mock response without project_id
      const mockStakworkRequest = vi.fn().mockResolvedValue({
        data: {}, // No project_id
      });
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
          "user-1"
        )
      ).rejects.toThrow("Failed to get project ID from Stakwork");

      // Should mark run as FAILED
      expect(db.stakworkRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { status: WorkflowStatus.FAILED },
      });
    });

    test("should correctly decrypt sensitive fields before sending to Stakwork", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "OWNER" }],
        swarm: {
          swarmUrl: "https://swarm.example.com",
          swarmApiKey: "encrypted-swarm-key",
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

      const mockRun = {
        id: "run-1",
        type: StakworkRunType.ARCHITECTURE,
        workspaceId: "ws-1",
        status: WorkflowStatus.PENDING,
        webhookUrl: "",
      };

      const mockUpdatedRun = {
        ...mockRun,
        projectId: 12345,
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue(mockUser);
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn()
        .mockResolvedValueOnce({ ...mockRun, webhookUrl: "http://test.com/webhook" })
        .mockResolvedValueOnce(mockUpdatedRun);

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        data: { project_id: 12345 },
      });
      mockedStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      await createStakworkRun(
        {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: "ws-1",
          featureId: null,
        },
        "user-1"
      );

      // Verify decrypted values are in payload
      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          workflow_params: expect.objectContaining({
            set_var: expect.objectContaining({
              attributes: expect.objectContaining({
                vars: expect.objectContaining({
                  pat: "decrypted-access_token",
                  swarmApiKey: "decrypted-swarmApiKey",
                }),
              }),
            }),
          }),
        })
      );
    });

    test("should include custom params override in Stakwork payload", async () => {
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
        webhookUrl: "",
      };

      const mockUpdatedRun = {
        ...mockRun,
        projectId: 12345,
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue({ id: "user-1" });
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn()
        .mockResolvedValueOnce({ ...mockRun, webhookUrl: "http://test.com/webhook" })
        .mockResolvedValueOnce(mockUpdatedRun);

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        data: { project_id: 12345 },
      });
      mockedStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      const customParams = {
        customVar1: "value1",
        customVar2: 42,
        customVar3: true,
      };

      await createStakworkRun(
        {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: "ws-1",
          featureId: null,
          params: customParams,
        },
        "user-1"
      );

      // Verify custom params are in payload
      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          workflow_params: expect.objectContaining({
            set_var: expect.objectContaining({
              attributes: expect.objectContaining({
                vars: expect.objectContaining(customParams),
              }),
            }),
          }),
        })
      );
    });

    test("should include conversation history when provided for FEEDBACK flows", async () => {
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
        webhookUrl: "",
      };

      const mockUpdatedRun = {
        ...mockRun,
        projectId: 12345,
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue({ id: "user-1" });
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn()
        .mockResolvedValueOnce({ ...mockRun, webhookUrl: "http://test.com/webhook" })
        .mockResolvedValueOnce(mockUpdatedRun);

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        data: { project_id: 12345 },
      });
      mockedStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      const conversationHistory = [
        { role: "assistant" as const, content: "Here's the initial architecture..." },
        { role: "user" as const, content: "Please add more detail about the database schema" },
        { role: "assistant" as const, content: "Here's the updated architecture with database details..." },
      ];

      await createStakworkRun(
        {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: "ws-1",
          featureId: null,
          history: conversationHistory,
        },
        "user-1"
      );

      // Verify history is in payload
      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          workflow_params: expect.objectContaining({
            set_var: expect.objectContaining({
              attributes: expect.objectContaining({
                vars: expect.objectContaining({
                  history: conversationHistory,
                }),
              }),
            }),
          }),
        })
      );
    });

    test("should construct webhookUrl with run.id for Stakwork routing", async () => {
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
        id: "run-123-unique",
        type: StakworkRunType.ARCHITECTURE,
        workspaceId: "ws-1",
        status: WorkflowStatus.PENDING,
        webhookUrl: "",
      };

      const mockUpdatedRun = {
        ...mockRun,
        projectId: 12345,
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue({ id: "user-1" });
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn()
        .mockResolvedValueOnce({ ...mockRun, webhookUrl: "http://test.com/webhook" })
        .mockResolvedValueOnce(mockUpdatedRun);

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        data: { project_id: 12345 },
      });
      mockedStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      await createStakworkRun(
        {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: "ws-1",
          featureId: null,
        },
        "user-1"
      );

      // Verify webhook_url in Stakwork payload contains run.id
      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          webhook_url: expect.stringContaining("run-123-unique"),
        })
      );

      // Verify webhookUrl update contains correct query params
      expect(db.stakworkRun.update).toHaveBeenNthCalledWith(1, {
        where: { id: "run-123-unique" },
        data: expect.objectContaining({
          webhookUrl: expect.stringContaining("workspace_id=ws-1"),
        }),
      });
    });

    test("should verify Stakwork payload structure matches expected format", async () => {
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
        webhookUrl: "",
      };

      const mockUpdatedRun = {
        ...mockRun,
        projectId: 12345,
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue({ id: "user-1" });
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn()
        .mockResolvedValueOnce({ ...mockRun, webhookUrl: "http://test.com/webhook" })
        .mockResolvedValueOnce(mockUpdatedRun);

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        data: { project_id: 12345 },
      });
      mockedStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      await createStakworkRun(
        {
          type: StakworkRunType.ARCHITECTURE,
          workspaceId: "ws-1",
          featureId: null,
        },
        "user-1"
      );

      // Verify complete payload structure
      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          name: expect.stringMatching(/^ai-gen-architecture-\d+$/),
          workflow_id: 123,
          webhook_url: expect.stringContaining("/api/stakwork/webhook"),
          workflow_params: {
            set_var: {
              attributes: {
                vars: expect.objectContaining({
                  runId: "run-1",
                  type: StakworkRunType.ARCHITECTURE,
                  workspaceId: "ws-1",
                  featureId: null,
                  webhookUrl: expect.stringContaining("/api/webhook/stakwork/response"),
                }),
              },
            },
          },
        })
      );
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
        }
      );

      expect(db.stakworkRun.updateMany).toHaveBeenCalledWith({
        where: {
          id: "run-1",
          status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS, WorkflowStatus.COMPLETED] },
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
        })
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
        }
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
          }
        )
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
      await processStakworkRunWebhook(
        { result: "string result" },
        { type: "ARCHITECTURE", workspace_id: "ws-1" }
      );
      expect(db.stakworkRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dataType: "string",
            result: "string result",
          }),
        })
      );

      // Test array result
      await processStakworkRunWebhook(
        { result: ["item1", "item2"] },
        { type: "ARCHITECTURE", workspace_id: "ws-1" }
      );
      expect(db.stakworkRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dataType: "array",
            result: JSON.stringify(["item1", "item2"]),
          }),
        })
      );

      // Test null result
      await processStakworkRunWebhook(
        { result: null },
        { type: "ARCHITECTURE", workspace_id: "ws-1" }
      );
      expect(db.stakworkRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dataType: "null",
            result: null,
          }),
        })
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
        { type: "ARCHITECTURE", workspace_id: "ws-1" }
      );

      expect(result.runId).toBe("run-1");
    });

    test("should extract diagram data from nested request_params.result structure", async () => {
      const diagramComponents = [
        { id: "c1", name: "API Gateway", type: "gateway" },
        { id: "c2", name: "User Service", type: "service" },
      ];
      const diagramConnections = [
        { from: "c1", to: "c2", label: "REST" },
      ];

      const mockRun = {
        id: "run-1",
        type: StakworkRunType.DIAGRAM_GENERATION,
        featureId: "feature-1",
        workspace: { slug: "test-workspace" },
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockedDb.feature.findUnique = vi.fn().mockResolvedValue({ title: "Test Feature" });
      mockedDb.whiteboard.upsert = vi.fn().mockResolvedValue({});
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      // Mock the dynamic import of excalidraw-layout
      vi.resetModules();
      const mockRelayoutDiagram = vi.fn().mockResolvedValue({
        elements: [{ id: "el-1", type: "rectangle" }],
        appState: { viewBackgroundColor: "#ffffff", gridSize: null },
      });
      vi.doMock("@/services/excalidraw-layout", () => ({
        relayoutDiagram: mockRelayoutDiagram,
      }));

      // Nested Stakwork format: request_params.result wraps the actual data
      const nestedResult = {
        request_params: {
          result: {
            components: diagramComponents,
            connections: diagramConnections,
          },
        },
      };

      const result = await processStakworkRunWebhook(
        {
          result: nestedResult,
          project_status: "completed",
          project_id: 12345,
        },
        {
          type: "DIAGRAM_GENERATION",
          workspace_id: "ws-1",
          feature_id: "feature-1",
        }
      );

      expect(result.runId).toBe("run-1");
      expect(result.status).toBe(WorkflowStatus.COMPLETED);

      // Verify relayoutDiagram was called with the extracted flat diagram data
      expect(mockRelayoutDiagram).toHaveBeenCalledWith(
        { components: diagramComponents, connections: diagramConnections },
        "layered"
      );

      // Verify whiteboard was upserted
      expect(db.whiteboard.upsert).toHaveBeenCalledWith({
        where: { featureId: "feature-1" },
        update: {
          elements: expect.any(Array),
          appState: expect.any(Object),
        },
        create: expect.objectContaining({
          name: "Test Feature - Architecture",
          workspaceId: "ws-1",
          featureId: "feature-1",
          elements: expect.any(Array),
        }),
      });
    });

    test("should handle top-level components/connections for backward compat", async () => {
      const diagramComponents = [
        { id: "c1", name: "Database", type: "database" },
      ];
      const diagramConnections: never[] = [];

      const mockRun = {
        id: "run-2",
        type: StakworkRunType.DIAGRAM_GENERATION,
        featureId: "feature-2",
        workspace: { slug: "test-workspace" },
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockedDb.feature.findUnique = vi.fn().mockResolvedValue({ title: "Feature 2" });
      mockedDb.whiteboard.upsert = vi.fn().mockResolvedValue({});
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      vi.resetModules();
      const mockRelayoutDiagram = vi.fn().mockResolvedValue({
        elements: [{ id: "el-1", type: "rectangle" }],
        appState: { viewBackgroundColor: "#ffffff", gridSize: null },
      });
      vi.doMock("@/services/excalidraw-layout", () => ({
        relayoutDiagram: mockRelayoutDiagram,
      }));

      // Top-level format (backward compat)
      const flatResult = {
        components: diagramComponents,
        connections: diagramConnections,
      };

      await processStakworkRunWebhook(
        {
          result: flatResult,
          project_status: "completed",
          project_id: 12346,
        },
        {
          type: "DIAGRAM_GENERATION",
          workspace_id: "ws-1",
          feature_id: "feature-2",
        }
      );

      expect(mockRelayoutDiagram).toHaveBeenCalledWith(
        { components: diagramComponents, connections: diagramConnections },
        "layered"
      );
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
        "user-1"
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
        "user-1"
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

      await expect(
        getStakworkRuns({ workspaceId: "non-existent", limit: 10, offset: 0 }, "user-1")
      ).rejects.toThrow("Workspace not found");
    });

    test("should throw error when user not a member", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "different-user",
        members: [],
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);

      await expect(
        getStakworkRuns({ workspaceId: "ws-1", limit: 10, offset: 0 }, "user-1")
      ).rejects.toThrow("Access denied");
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
        })
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
        })
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
        })
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

  describe("stopStakworkRun", () => {
    test("should stop a stakwork run successfully", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "12345",
        status: WorkflowStatus.IN_PROGRESS,
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "user-1",
          deleted: false,
          members: [{ userId: "user-1", role: "OWNER" }],
        },
      };

      const updatedRun = {
        ...mockRun,
        status: WorkflowStatus.HALTED,
        result: null,
        feedback: null,
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue(updatedRun);
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const mockStopProject = vi.fn().mockResolvedValue({});
      mockedStakworkService.mockReturnValue({
        stopProject: mockStopProject,
      } as any);

      const result = await stopStakworkRun("run-1", "user-1");

      expect(mockStopProject).toHaveBeenCalledWith("12345");
      expect(db.stakworkRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: {
          status: WorkflowStatus.HALTED,
          result: null,
          feedback: null,
        },
      });
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        "workspace-test-workspace",
        "stakwork-run-update",
        expect.objectContaining({
          runId: "run-1",
          status: WorkflowStatus.HALTED,
        })
      );
      expect(result.status).toBe(WorkflowStatus.HALTED);
    });

    test("should throw error when run not found", async () => {
      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(null);

      await expect(
        stopStakworkRun("non-existent", "user-1")
      ).rejects.toThrow("Run not found");
    });

    test("should throw error when workspace is deleted", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "12345",
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "user-1",
          deleted: true,
          members: [],
        },
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);

      await expect(
        stopStakworkRun("run-1", "user-1")
      ).rejects.toThrow("Workspace has been deleted");
    });

    test("should throw error when user is not owner or member", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "12345",
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "different-user",
          deleted: false,
          members: [], // User is not a member
        },
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);

      await expect(
        stopStakworkRun("run-1", "user-1")
      ).rejects.toThrow("Access denied: user is not a member of this workspace");
    });

    test("should throw error when run does not have projectId", async () => {
      const mockRun = {
        id: "run-1",
        projectId: null,
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "user-1",
          deleted: false,
          members: [{ userId: "user-1", role: "OWNER" }],
        },
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);

      await expect(
        stopStakworkRun("run-1", "user-1")
      ).rejects.toThrow("Run does not have a projectId - cannot stop");
    });

    test("should continue with optimistic update even if Stakwork API fails", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "12345",
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "user-1",
          deleted: false,
          members: [{ userId: "user-1", role: "OWNER" }],
        },
      };

      const updatedRun = {
        ...mockRun,
        status: WorkflowStatus.HALTED,
        result: null,
        feedback: null,
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue(updatedRun);
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      // Stakwork API fails
      const mockStopProject = vi.fn().mockRejectedValue(new Error("Stakwork API error"));
      mockedStakworkService.mockReturnValue({
        stopProject: mockStopProject,
      } as any);

      // Should not throw error
      const result = await stopStakworkRun("run-1", "user-1");

      expect(mockStopProject).toHaveBeenCalledWith("12345");
      expect(db.stakworkRun.update).toHaveBeenCalled();
      expect(result.status).toBe(WorkflowStatus.HALTED);
    });

    test("should allow workspace owner to stop run", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "12345",
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "owner-user",
          deleted: false,
          members: [], // Not a member, but is owner
        },
      };

      const updatedRun = {
        ...mockRun,
        status: WorkflowStatus.HALTED,
        result: null,
        feedback: null,
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue(updatedRun);
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const mockStopProject = vi.fn().mockResolvedValue({});
      mockedStakworkService.mockReturnValue({
        stopProject: mockStopProject,
      } as any);

      const result = await stopStakworkRun("run-1", "owner-user");

      expect(result.status).toBe(WorkflowStatus.HALTED);
    });

    test("should allow workspace member to stop run", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "12345",
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "different-user",
          deleted: false,
          members: [{ userId: "member-user", role: "MEMBER" }],
        },
      };

      const updatedRun = {
        ...mockRun,
        status: WorkflowStatus.HALTED,
        result: null,
        feedback: null,
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue(updatedRun);
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const mockStopProject = vi.fn().mockResolvedValue({});
      mockedStakworkService.mockReturnValue({
        stopProject: mockStopProject,
      } as any);

      const result = await stopStakworkRun("run-1", "member-user");

      expect(result.status).toBe(WorkflowStatus.HALTED);
    });

    test("should handle Pusher failure gracefully", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "12345",
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "user-1",
          deleted: false,
          members: [{ userId: "user-1", role: "OWNER" }],
        },
      };

      const updatedRun = {
        ...mockRun,
        status: WorkflowStatus.HALTED,
        result: null,
        feedback: null,
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue(updatedRun);
      mockedPusherServer.trigger = vi.fn().mockRejectedValue(new Error("Pusher error"));

      const mockStopProject = vi.fn().mockResolvedValue({});
      mockedStakworkService.mockReturnValue({
        stopProject: mockStopProject,
      } as any);

      // Should not throw error
      const result = await stopStakworkRun("run-1", "user-1");

      expect(result).toBeDefined();
      expect(result.status).toBe(WorkflowStatus.HALTED);
    });

    test("should broadcast correct event data to Pusher", async () => {
      const mockRun = {
        id: "run-1",
        type: StakworkRunType.ARCHITECTURE,
        projectId: "12345",
        featureId: "feature-1",
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "user-1",
          deleted: false,
          members: [{ userId: "user-1", role: "OWNER" }],
        },
      };

      const updatedRun = {
        ...mockRun,
        id: "run-1",
        status: WorkflowStatus.HALTED,
        type: StakworkRunType.ARCHITECTURE,
        featureId: "feature-1",
        result: null,
        feedback: null,
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue(updatedRun);
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const mockStopProject = vi.fn().mockResolvedValue({});
      mockedStakworkService.mockReturnValue({
        stopProject: mockStopProject,
      } as any);

      await stopStakworkRun("run-1", "user-1");

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        "workspace-test-workspace",
        "stakwork-run-update",
        expect.objectContaining({
          runId: "run-1",
          type: StakworkRunType.ARCHITECTURE,
          status: WorkflowStatus.HALTED,
          featureId: "feature-1",
          timestamp: expect.any(Date),
        })
      );
    });

    test("should clear result and feedback when stopping", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "12345",
        result: "Previous result content",
        feedback: "Previous feedback",
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "user-1",
          deleted: false,
          members: [{ userId: "user-1", role: "OWNER" }],
        },
      };

      const updatedRun = {
        ...mockRun,
        status: WorkflowStatus.HALTED,
        result: null,
        feedback: null,
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue(updatedRun);
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const mockStopProject = vi.fn().mockResolvedValue({});
      mockedStakworkService.mockReturnValue({
        stopProject: mockStopProject,
      } as any);

      await stopStakworkRun("run-1", "user-1");

      expect(db.stakworkRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: {
          status: WorkflowStatus.HALTED,
          result: null,
          feedback: null,
        },
      });
    });
  });
});
