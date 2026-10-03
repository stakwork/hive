import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createStakworkRun,
  processStakworkRunWebhook,
  getStakworkRuns,
  updateStakworkRunDecision,
  stopStakworkRun,
} from "@/services/stakwork-run";
import { db } from "@/lib/db";
import { stakworkService } from "@/lib/service-factory";
import { pusherServer, getFeatureChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { syncPlannerWorkflowStatusToCanvas } from "@/services/canvas-planner-fanout";
import { FieldEncryptionService } from "@/lib/encryption/field-encryption";
import { StakworkRunType, StakworkRunDecision, WorkflowStatus } from "@prisma/client";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";
import { saveWorkflowArtifact } from "@/services/workflow-editor";

vi.mock("@/lib/db");
vi.mock("@/lib/service-factory");
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  getFeatureChannelName: vi.fn((id: string) => `feature-${id}`),
  PUSHER_EVENTS: {
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
    STAKWORK_RUN_DECISION: "stakwork-run-decision",
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
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

vi.mock("@/lib/sphinx/daily-pr-summary", () => ({
  sendToSphinx: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: vi.fn().mockReturnValue(false),
}));

vi.mock("@/services/workflow-editor", () => ({
  saveWorkflowArtifact: vi.fn().mockResolvedValue(undefined),
  triggerWorkflowEditorRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/canvas-planner-fanout", () => ({
  syncPlannerWorkflowStatusToCanvas: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_AI_GENERATION_WORKFLOW_ID: "123",
    STAKWORK_DIAGRAM_WORKFLOW_ID: "777",
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
  // Bifrost gates — the orchestrator imports these directly (see
  // src/services/bifrost/orchestrator.ts). `createStakworkRun` calls
  // `getBifrostForLLM` for TASK_GENERATION runs, which would otherwise
  // hit the real env-var reader and throw under this fully-replaced
  // mock. Returning `false` from the workspace gate makes the
  // orchestrator short-circuit to `undefined`, leaving the payload
  // byte-identical to the pre-Bifrost behavior these tests assert.
  isBifrostEnabledForWorkspace: vi.fn().mockReturnValue(false),
  isBifrostEnabledForAgent: vi.fn().mockReturnValue(false),
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
                  tokenReference: "{{HIVE_STAGING}}", // Default when VERCEL_ENV is undefined
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
      // No active run — guard should pass
      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(null);
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

    test("should use featureId in project name when featureId is present", async () => {
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
      mockedDb.feature.findFirst = vi.fn().mockResolvedValue({
        id: "feature-abc",
        title: "Test Feature",
        brief: null,
        architecture: null,
        userStories: [],
        workspace: { description: null },
        phases: [],
      });
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
          featureId: "feature-abc",
        },
        "user-1"
      );

      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          name: "ai-gen-architecture-feature-abc",
        })
      );
    });

    test("should fall back to Date.now() in project name when featureId is null", async () => {
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

      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          name: expect.stringMatching(/^ai-gen-architecture-\d+$/),
        })
      );
    });

    test("should throw active_run error when a PENDING TASK_GENERATION run already exists for the same feature", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "OWNER" }],
        swarm: null,
        sourceControlOrg: null,
        repositories: [],
      };

      const existingRun = { id: "existing-run-1", status: WorkflowStatus.PENDING };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(existingRun);

      await expect(
        createStakworkRun(
          {
            type: StakworkRunType.TASK_GENERATION,
            workspaceId: "ws-1",
            featureId: "feature-1",
          },
          "user-1"
        )
      ).rejects.toThrow("active_run:existing-run-1");

      // Should not create a new DB record
      expect(db.stakworkRun.create).not.toHaveBeenCalled();
    });

    test("should throw active_run error when an IN_PROGRESS TASK_GENERATION run already exists for the same feature", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "OWNER" }],
        swarm: null,
        sourceControlOrg: null,
        repositories: [],
      };

      const existingRun = { id: "existing-run-2", status: WorkflowStatus.IN_PROGRESS };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(existingRun);

      await expect(
        createStakworkRun(
          {
            type: StakworkRunType.TASK_GENERATION,
            workspaceId: "ws-1",
            featureId: "feature-1",
          },
          "user-1"
        )
      ).rejects.toThrow("active_run:existing-run-2");

      expect(db.stakworkRun.create).not.toHaveBeenCalled();
    });

    test("should NOT apply the duplicate guard for non-TASK_GENERATION types", async () => {
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "OWNER" }],
        swarm: null,
        sourceControlOrg: null,
        repositories: [],
      };

      const mockUser = { id: "user-1", githubAuth: null };
      const mockRun = {
        id: "run-1",
        type: StakworkRunType.ARCHITECTURE,
        workspaceId: "ws-1",
        featureId: "feature-1",
        status: WorkflowStatus.PENDING,
        webhookUrl: "",
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue(mockUser);
      mockedDb.feature.findFirst = vi.fn().mockResolvedValue({
        id: "feature-1",
        title: "T",
        brief: null,
        userStories: [],
        workspace: { description: "" },
        phases: [],
      });
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({
        ...mockRun,
        projectId: 99,
        status: WorkflowStatus.IN_PROGRESS,
      });

      const mockStakworkRequest = vi.fn().mockResolvedValue({ data: { project_id: 99 } });
      mockedStakworkService.mockReturnValue({ stakworkRequest: mockStakworkRequest } as any);

      // Should NOT call findFirst for the duplicate guard
      const result = await createStakworkRun(
        { type: StakworkRunType.ARCHITECTURE, workspaceId: "ws-1", featureId: "feature-1" },
        "user-1"
      );

      expect(result.status).toBe(WorkflowStatus.IN_PROGRESS);
      // findFirst should NOT have been called for the active-run guard
      // (it may still be called internally for other reasons, but the guard skips ARCHITECTURE)
      const findFirstCalls = (mockedDb.stakworkRun.findFirst as ReturnType<typeof vi.fn>).mock.calls;
      const guardCalls = findFirstCalls.filter((call: unknown[]) => {
        const args = call[0] as { where?: { type?: StakworkRunType } } | undefined;
        return args?.where?.type === StakworkRunType.ARCHITECTURE;
      });
      expect(guardCalls).toHaveLength(0);
    });

    const makeWorkflowPlanningWorkspace = (slug: string) => ({
      id: "ws-1",
      slug,
      ownerId: "user-1",
      deleted: false,
      members: [{ role: "OWNER" }],
      swarm: null,
      sourceControlOrg: null,
      repositories: [],
    });

    const makeWorkflowPlanningFeature = () => ({
      id: "feature-1",
      title: "Test Feature",
      brief: "Test brief",
      userStories: [],
      workspace: { description: "" },
      phases: [],
    });

    const setupWorkflowPlanningMocks = (slug: string) => {
      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(makeWorkflowPlanningWorkspace(slug));
      mockedDb.user.findUnique = vi.fn().mockResolvedValue({ id: "user-1", githubAuth: { githubUsername: "testuser" } });
      mockedDb.feature.findFirst = vi.fn().mockResolvedValue(makeWorkflowPlanningFeature());
      const mockRun = { id: "run-1", type: StakworkRunType.TASK_GENERATION, workspaceId: "ws-1", featureId: "feature-1", status: WorkflowStatus.PENDING, webhookUrl: "" };
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(null);
      mockedDb.stakworkRun.update = vi.fn()
        .mockResolvedValueOnce({ ...mockRun, webhookUrl: "http://test.com/webhook" })
        .mockResolvedValueOnce({ ...mockRun, projectId: 999, status: WorkflowStatus.IN_PROGRESS });
      const mockStakworkRequest = vi.fn().mockResolvedValue({ data: { project_id: 999 } });
      mockedStakworkService.mockReturnValue({ stakworkRequest: mockStakworkRequest } as any);
      return mockStakworkRequest;
    };

    test("should inject workflowPlanningEnabled=true when workspace slug is 'stakwork'", async () => {
      vi.mocked(isDevelopmentMode).mockReturnValue(false);
      const mockStakworkRequest = setupWorkflowPlanningMocks("stakwork");

      await createStakworkRun(
        { type: StakworkRunType.TASK_GENERATION, workspaceId: "ws-1", featureId: "feature-1" },
        "user-1"
      );

      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          workflow_params: expect.objectContaining({
            set_var: expect.objectContaining({
              attributes: expect.objectContaining({
                vars: expect.objectContaining({ workflowPlanningEnabled: true }),
              }),
            }),
          }),
        })
      );
    });

    test("should NOT inject workflowPlanningEnabled for non-stakwork workspace in production mode", async () => {
      vi.mocked(isDevelopmentMode).mockReturnValue(false);
      const mockStakworkRequest = setupWorkflowPlanningMocks("other-workspace");

      await createStakworkRun(
        { type: StakworkRunType.TASK_GENERATION, workspaceId: "ws-1", featureId: "feature-1" },
        "user-1"
      );

      const callArgs = mockStakworkRequest.mock.calls[0][1] as any;
      const vars = callArgs?.workflow_params?.set_var?.attributes?.vars ?? {};
      expect(vars.workflowPlanningEnabled).toBeUndefined();
    });

    test("should inject workflowPlanningEnabled=true when isDevelopmentMode() is true regardless of slug", async () => {
      vi.mocked(isDevelopmentMode).mockReturnValue(true);
      const mockStakworkRequest = setupWorkflowPlanningMocks("any-workspace");

      await createStakworkRun(
        { type: StakworkRunType.TASK_GENERATION, workspaceId: "ws-1", featureId: "feature-1" },
        "user-1"
      );

      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          workflow_params: expect.objectContaining({
            set_var: expect.objectContaining({
              attributes: expect.objectContaining({
                vars: expect.objectContaining({ workflowPlanningEnabled: true }),
              }),
            }),
          }),
        })
      );
    });

    test("should reject DIAGRAM_GENERATION before any DB write, secret decryption or Stakwork call", async () => {
      await expect(
        createStakworkRun(
          {
            type: StakworkRunType.DIAGRAM_GENERATION,
            workspaceId: "ws-1",
          } as any,
          "user-1"
        )
      ).rejects.toThrow("DIAGRAM_GENERATION run type is retired");

      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.stakworkRun.create).not.toHaveBeenCalled();
      expect(mockedStakworkService).not.toHaveBeenCalled();
    });
  });

  describe("processStakworkRunWebhook", () => {
    test("should throw 'Unauthorized: run type retired' for DIAGRAM_GENERATION", async () => {
      const mockRun = {
        id: "run-diagram-retired",
        type: StakworkRunType.DIAGRAM_GENERATION,
        workspaceId: "ws-1",
        workspace: { slug: "test-workspace" },
        status: WorkflowStatus.IN_PROGRESS,
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);

      await expect(
        processStakworkRunWebhook(
          { result: "test", project_status: "completed" },
          { type: "DIAGRAM_GENERATION", workspace_id: "ws-1" }
        )
      ).rejects.toThrow("Unauthorized: run type retired");

      expect(db.stakworkRun.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("processStakworkRunWebhook — other run types", () => {
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

    test("should use feature creator identity when auto-accepting TASK_GENERATION", async () => {
      const mockRun = {
        id: "run-1",
        type: StakworkRunType.TASK_GENERATION,
        featureId: "feature-1",
        workspaceId: "ws-1",
        status: WorkflowStatus.IN_PROGRESS,
        autoAccept: true,
        workspace: {
          slug: "test-workspace",
          ownerId: "workspace-owner-id",
        },
        feature: {
          createdById: "feature-creator-id",
        },
      };

      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        phases: [
          {
            id: "phase-1",
            name: "Phase 1",
            order: 0,
          },
        ],
        workspace: {
          id: "ws-1",
        },
      };

      const mockCreatedTask = {
        id: "task-1",
        title: "Task 1",
        createdById: "feature-creator-id",
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({
        ...mockRun,
        status: WorkflowStatus.COMPLETED,
        decision: StakworkRunDecision.ACCEPTED,
      });
      mockedDb.feature.findUnique = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.repository.findMany = vi.fn().mockResolvedValue([]);
      mockedDb.task.create = vi.fn().mockResolvedValue(mockCreatedTask);
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const taskGenerationResult = {
        phases: [
          {
            tasks: [
              {
                tempId: "t1",
                title: "Task 1",
                description: "",
                priority: "MEDIUM",
              },
            ],
          },
        ],
      };

      await processStakworkRunWebhook(
        {
          project_status: "completed",
          result: taskGenerationResult,
        },
        {
          type: "TASK_GENERATION",
          workspace_id: "ws-1",
          feature_id: "feature-1",
        }
      );

      // Assert task was created with feature creator's ID, not workspace owner's
      expect(mockedDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          createdById: "feature-creator-id",
          title: "Task 1",
          priority: "MEDIUM",
        }),
      });

      // Verify stakworkRun.update was called to set decision to ACCEPTED
      expect(mockedDb.stakworkRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: { decision: StakworkRunDecision.ACCEPTED },
      });
    });

    test("should dual-write WorkflowTask and artifact for workflow-targeting tasks", async () => {
      const mockRun = {
        id: "run-wf-1",
        type: StakworkRunType.TASK_GENERATION,
        featureId: "feature-wf",
        workspaceId: "ws-1",
        status: WorkflowStatus.IN_PROGRESS,
        autoAccept: true,
        workspace: {
          slug: "test-workspace",
          ownerId: "workspace-owner-id",
        },
        feature: {
          createdById: "feature-creator-id",
        },
      };

      const mockFeature = {
        id: "feature-wf",
        title: "Workflow Feature",
        phases: [{ id: "phase-wf", name: "Phase 1", order: 0 }],
        workspace: { id: "ws-1" },
      };

      const mockWorkflowTaskCreated = { id: "created-wf-task" };
      const mockPlainTaskCreated = { id: "created-plain-task" };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({
        ...mockRun,
        status: WorkflowStatus.COMPLETED,
        decision: StakworkRunDecision.ACCEPTED,
      });
      mockedDb.feature.findUnique = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.repository.findMany = vi.fn().mockResolvedValue([{ id: "repo-1", repositoryUrl: "https://github.com/org/repo" }]);
      mockedDb.task.create = vi
        .fn()
        .mockResolvedValueOnce(mockWorkflowTaskCreated)
        .mockResolvedValueOnce(mockPlainTaskCreated);
      mockedDb.workflowTask = { create: vi.fn().mockResolvedValue({ id: "wt-1" }) } as any;
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const mockedSaveWorkflowArtifact = vi.mocked(saveWorkflowArtifact);
      mockedSaveWorkflowArtifact.mockClear();

      const taskGenerationResult = {
        phases: [
          {
            tasks: [
              {
                tempId: "t-wf",
                title: "Workflow Task",
                description: "A workflow task",
                priority: "MEDIUM",
                workflowId: 42,
                workflowName: "test-workflow",
                workflowRefId: "ref-001",
                mode: "workflow_editor",
              },
              {
                tempId: "t-plain",
                title: "Plain Task",
                description: "A plain code task",
                priority: "HIGH",
              },
            ],
          },
        ],
      };

      await processStakworkRunWebhook(
        {
          project_status: "completed",
          result: taskGenerationResult,
        },
        {
          type: "TASK_GENERATION",
          workspace_id: "ws-1",
          feature_id: "feature-wf",
        }
      );

      // Workflow task created with mode and null repositoryId
      expect(mockedDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "Workflow Task",
          mode: "workflow_editor",
          repositoryId: null,
          branch: null,
        }),
      });

      // Plain task created without mode and with repositoryId
      expect(mockedDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "Plain Task",
          repositoryId: "repo-1",
        }),
      });
      const plainTaskCall = (mockedDb.task.create as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: any[]) => c[0].data.title === "Plain Task"
      );
      expect(plainTaskCall?.[0].data.mode).toBeUndefined();

      // WorkflowTask dual-write
      expect(mockedDb.workflowTask.create).toHaveBeenCalledTimes(1);
      expect(mockedDb.workflowTask.create).toHaveBeenCalledWith({
        data: {
          taskId: "created-wf-task",
          workflowId: 42,
          workflowName: "test-workflow",
          workflowRefId: "ref-001",
          workflowTaskType: null,
        },
      });

      // saveWorkflowArtifact called once for the workflow task
      expect(mockedSaveWorkflowArtifact).toHaveBeenCalledTimes(1);
      expect(mockedSaveWorkflowArtifact).toHaveBeenCalledWith("created-wf-task", {
        workflowId: 42,
        workflowName: "test-workflow",
        workflowRefId: "ref-001",
      });
    });

    test("should write workflowTaskType from AI payload to WorkflowTask row", async () => {
      const mockRun = {
        id: "run-wf-type-1",
        type: StakworkRunType.TASK_GENERATION,
        featureId: "feature-wf-type",
        workspaceId: "ws-1",
        status: WorkflowStatus.IN_PROGRESS,
        autoAccept: true,
        workspace: { slug: "test-workspace", ownerId: "workspace-owner-id" },
        feature: { createdById: "feature-creator-id" },
      };
      const mockFeature = {
        id: "feature-wf-type",
        title: "Workflow Type Feature",
        phases: [{ id: "phase-1", name: "Phase 1", order: 0 }],
        workspace: { id: "ws-1" },
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({
        ...mockRun,
        status: WorkflowStatus.COMPLETED,
        decision: StakworkRunDecision.ACCEPTED,
      });
      mockedDb.feature.findUnique = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.repository.findMany = vi.fn().mockResolvedValue([]);
      mockedDb.task.create = vi.fn().mockResolvedValue({ id: "task-skill-1" });
      mockedDb.workflowTask = { create: vi.fn().mockResolvedValue({ id: "wt-skill-1" }) } as any;
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});
      vi.mocked(saveWorkflowArtifact).mockClear();

      const taskGenerationResult = {
        phases: [
          {
            tasks: [
              {
                tempId: "t-skill",
                title: "Skill Workflow Task",
                description: "A skill",
                priority: "HIGH",
                workflowId: 77,
                workflowName: "my-skill",
                workflowRefId: "ref-skill",
                workflowTaskType: "SKILL",
                mode: "workflow_editor",
              },
            ],
          },
        ],
      };

      await processStakworkRunWebhook(
        { project_status: "completed", result: taskGenerationResult },
        { type: "TASK_GENERATION", workspace_id: "ws-1", feature_id: "feature-wf-type" }
      );

      expect(mockedDb.workflowTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ workflowTaskType: "SKILL" }),
      });
    });

    test("should treat task with mode='live' and workflowId as a coding task (not workflow)", async () => {
      const mockRun = {
        id: "run-live-1",
        type: StakworkRunType.TASK_GENERATION,
        featureId: "feature-live",
        workspaceId: "ws-1",
        status: WorkflowStatus.IN_PROGRESS,
        autoAccept: true,
        workspace: { slug: "test-workspace", ownerId: "workspace-owner-id" },
        feature: { createdById: "feature-creator-id" },
      };

      const mockFeature = {
        id: "feature-live",
        title: "Live Feature",
        phases: [{ id: "phase-live", name: "Phase 1", order: 0 }],
        workspace: { id: "ws-1" },
      };

      const mockCreatedTask = { id: "created-live-task" };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({
        ...mockRun,
        status: WorkflowStatus.COMPLETED,
        decision: StakworkRunDecision.ACCEPTED,
      });
      mockedDb.feature.findUnique = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.repository.findMany = vi.fn().mockResolvedValue([{ id: "repo-1", repositoryUrl: "https://github.com/org/repo" }]);
      mockedDb.task.create = vi.fn().mockResolvedValueOnce(mockCreatedTask);
      mockedDb.workflowTask = { create: vi.fn().mockResolvedValue({ id: "wt-1" }) } as any;
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const mockedSaveWorkflowArtifact = vi.mocked(saveWorkflowArtifact);
      mockedSaveWorkflowArtifact.mockClear();

      const taskGenerationResult = {
        phases: [
          {
            tasks: [
              {
                tempId: "t-live",
                title: "Live Mode Task",
                description: "Has workflowId but mode is live",
                priority: "MEDIUM",
                workflowId: 42,
                workflowName: "test-workflow",
                workflowRefId: "ref-001",
                mode: "live",
              },
            ],
          },
        ],
      };

      await processStakworkRunWebhook(
        { project_status: "completed", result: taskGenerationResult },
        { type: "TASK_GENERATION", workspace_id: "ws-1", feature_id: "feature-live" }
      );

      // Should be created as a coding task: repositoryId populated, mode NOT workflow_editor
      expect(mockedDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "Live Mode Task",
          repositoryId: "repo-1",
        }),
      });
      const taskCall = (mockedDb.task.create as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(taskCall[0].data.mode).not.toBe("workflow_editor");

      // No WorkflowTask row created
      expect(mockedDb.workflowTask.create).not.toHaveBeenCalled();
      // No workflow artifact saved
      expect(mockedSaveWorkflowArtifact).not.toHaveBeenCalled();
    });

    test("should treat task with no mode field as a coding task (backwards compat)", async () => {
      const mockRun = {
        id: "run-nomode-1",
        type: StakworkRunType.TASK_GENERATION,
        featureId: "feature-nomode",
        workspaceId: "ws-1",
        status: WorkflowStatus.IN_PROGRESS,
        autoAccept: true,
        workspace: { slug: "test-workspace", ownerId: "workspace-owner-id" },
        feature: { createdById: "feature-creator-id" },
      };

      const mockFeature = {
        id: "feature-nomode",
        title: "No Mode Feature",
        phases: [{ id: "phase-nomode", name: "Phase 1", order: 0 }],
        workspace: { id: "ws-1" },
      };

      const mockCreatedTask = { id: "created-nomode-task" };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({
        ...mockRun,
        status: WorkflowStatus.COMPLETED,
        decision: StakworkRunDecision.ACCEPTED,
      });
      mockedDb.feature.findUnique = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.repository.findMany = vi.fn().mockResolvedValue([{ id: "repo-1", repositoryUrl: "https://github.com/org/repo" }]);
      mockedDb.task.create = vi.fn().mockResolvedValueOnce(mockCreatedTask);
      mockedDb.workflowTask = { create: vi.fn().mockResolvedValue({ id: "wt-1" }) } as any;
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const mockedSaveWorkflowArtifact = vi.mocked(saveWorkflowArtifact);
      mockedSaveWorkflowArtifact.mockClear();

      const taskGenerationResult = {
        phases: [
          {
            tasks: [
              {
                tempId: "t-nomode",
                title: "No Mode Task",
                description: "No mode field at all",
                priority: "MEDIUM",
              },
            ],
          },
        ],
      };

      await processStakworkRunWebhook(
        { project_status: "completed", result: taskGenerationResult },
        { type: "TASK_GENERATION", workspace_id: "ws-1", feature_id: "feature-nomode" }
      );

      // Should be created as a coding task: repositoryId populated
      expect(mockedDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "No Mode Task",
          repositoryId: "repo-1",
        }),
      });
      const taskCall = (mockedDb.task.create as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(taskCall[0].data.mode).toBeUndefined();

      // No WorkflowTask row created
      expect(mockedDb.workflowTask.create).not.toHaveBeenCalled();
      // No workflow artifact saved
      expect(mockedSaveWorkflowArtifact).not.toHaveBeenCalled();
    });

    test("should fallback to workspace owner when feature has no creator", async () => {
      const mockRun = {
        id: "run-2",
        type: StakworkRunType.TASK_GENERATION,
        featureId: "feature-2",
        workspaceId: "ws-1",
        status: WorkflowStatus.IN_PROGRESS,
        autoAccept: true,
        workspace: {
          slug: "test-workspace",
          ownerId: "workspace-owner-id",
        },
        feature: null,
      };

      const mockFeature = {
        id: "feature-2",
        title: "Test Feature 2",
        phases: [
          {
            id: "phase-1",
            name: "Phase 1",
            order: 0,
          },
        ],
        workspace: {
          id: "ws-1",
        },
      };

      const mockCreatedTask = {
        id: "task-2",
        title: "Task 2",
        createdById: "workspace-owner-id",
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({
        ...mockRun,
        status: WorkflowStatus.COMPLETED,
        decision: StakworkRunDecision.ACCEPTED,
      });
      mockedDb.feature.findUnique = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.repository.findMany = vi.fn().mockResolvedValue([]);
      mockedDb.task.create = vi.fn().mockResolvedValue(mockCreatedTask);
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const taskGenerationResult = {
        phases: [
          {
            tasks: [
              {
                tempId: "t2",
                title: "Task 2",
                description: "",
                priority: "HIGH",
              },
            ],
          },
        ],
      };

      await processStakworkRunWebhook(
        {
          project_status: "completed",
          result: taskGenerationResult,
        },
        {
          type: "TASK_GENERATION",
          workspace_id: "ws-1",
          feature_id: "feature-2",
        }
      );

      // Assert task was created with workspace owner's ID as fallback
      expect(mockedDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          createdById: "workspace-owner-id",
          title: "Task 2",
          priority: "HIGH",
        }),
      });

      // Verify stakworkRun.update was called to set decision to ACCEPTED
      expect(mockedDb.stakworkRun.update).toHaveBeenCalledWith({
        where: { id: "run-2" },
        data: { decision: StakworkRunDecision.ACCEPTED },
      });
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
        select: expect.any(Object),
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

    test("should include result: true in select when includeResult is true", async () => {
      const mockWorkspace = {
        id: "ws-1",
        members: [{ userId: "user-1" }],
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.stakworkRun.count = vi.fn().mockResolvedValue(0);
      mockedDb.stakworkRun.findMany = vi.fn().mockResolvedValue([]);

      await getStakworkRuns(
        { workspaceId: "ws-1", limit: 10, offset: 0, includeResult: true },
        "user-1"
      );

      expect(db.stakworkRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ result: true }),
        })
      );
    });

    test("should omit result from select when includeResult is false", async () => {
      const mockWorkspace = {
        id: "ws-1",
        members: [{ userId: "user-1" }],
      };

      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.stakworkRun.count = vi.fn().mockResolvedValue(0);
      mockedDb.stakworkRun.findMany = vi.fn().mockResolvedValue([]);

      await getStakworkRuns(
        { workspaceId: "ws-1", limit: 10, offset: 0, includeResult: false },
        "user-1"
      );

      const call = vi.mocked(db.stakworkRun.findMany).mock.calls[0][0] as { select?: Record<string, unknown> };
      expect(call.select).not.toHaveProperty("result");
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

    test("should halt the feature for a PLAN_CHAT run", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "12345",
        type: StakworkRunType.PLAN_CHAT,
        featureId: "feature-1",
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "user-1",
          deleted: false,
          members: [{ userId: "user-1", role: "OWNER" }],
        },
        feature: { parentCanvasConversationId: "conv-1" },
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi
        .fn()
        .mockResolvedValue({ ...mockRun, status: WorkflowStatus.HALTED });
      mockedDb.feature.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});
      mockedStakworkService.mockReturnValue({
        stopProject: vi.fn().mockResolvedValue({}),
      } as any);

      await stopStakworkRun("run-1", "user-1");

      expect(db.feature.updateMany).toHaveBeenCalledWith({
        where: {
          id: "feature-1",
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        },
        data: expect.objectContaining({
          workflowStatus: WorkflowStatus.HALTED,
        }),
      });
      expect(syncPlannerWorkflowStatusToCanvas).toHaveBeenCalledWith(
        "conv-1",
        "feature-1",
        WorkflowStatus.HALTED,
      );
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        getFeatureChannelName("feature-1"),
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        expect.objectContaining({
          taskId: "feature-1",
          workflowStatus: WorkflowStatus.HALTED,
        }),
      );
    });

    test("should NOT halt the feature for a non-PLAN_CHAT run", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "12345",
        type: StakworkRunType.TASK_GENERATION,
        featureId: "feature-1",
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "user-1",
          deleted: false,
          members: [{ userId: "user-1", role: "OWNER" }],
        },
        feature: { parentCanvasConversationId: "conv-1" },
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi
        .fn()
        .mockResolvedValue({ ...mockRun, status: WorkflowStatus.HALTED });
      mockedDb.feature.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});
      mockedStakworkService.mockReturnValue({
        stopProject: vi.fn().mockResolvedValue({}),
      } as any);

      await stopStakworkRun("run-1", "user-1");

      expect(db.feature.updateMany).not.toHaveBeenCalled();
      expect(syncPlannerWorkflowStatusToCanvas).not.toHaveBeenCalled();
    });

    test("should not fire feature side effects when the feature was already terminal", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "12345",
        type: StakworkRunType.PLAN_CHAT,
        featureId: "feature-1",
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "user-1",
          deleted: false,
          members: [{ userId: "user-1", role: "OWNER" }],
        },
        feature: { parentCanvasConversationId: "conv-1" },
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi
        .fn()
        .mockResolvedValue({ ...mockRun, status: WorkflowStatus.HALTED });
      mockedDb.feature.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});
      mockedStakworkService.mockReturnValue({
        stopProject: vi.fn().mockResolvedValue({}),
      } as any);

      await stopStakworkRun("run-1", "user-1");

      expect(db.feature.updateMany).toHaveBeenCalled();
      expect(syncPlannerWorkflowStatusToCanvas).not.toHaveBeenCalled();
      expect(pusherServer.trigger).not.toHaveBeenCalledWith(
        getFeatureChannelName("feature-1"),
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        expect.anything(),
      );
    });

    test("should still stop the run when the canvas sync throws", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "12345",
        type: StakworkRunType.PLAN_CHAT,
        featureId: "feature-1",
        workspace: {
          id: "ws-1",
          slug: "test-workspace",
          ownerId: "user-1",
          deleted: false,
          members: [{ userId: "user-1", role: "OWNER" }],
        },
        feature: { parentCanvasConversationId: "conv-1" },
      };

      mockedDb.stakworkRun.findUnique = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi
        .fn()
        .mockResolvedValue({ ...mockRun, status: WorkflowStatus.HALTED });
      mockedDb.feature.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});
      mockedStakworkService.mockReturnValue({
        stopProject: vi.fn().mockResolvedValue({}),
      } as any);
      vi.mocked(syncPlannerWorkflowStatusToCanvas).mockRejectedValueOnce(
        new Error("canvas boom"),
      );

      const result = await stopStakworkRun("run-1", "user-1");

      expect(result.status).toBe(WorkflowStatus.HALTED);
    });
  });

  describe("Fast Track Chain", () => {
    test("should trigger ARCHITECTURE run when REQUIREMENTS completes on fast-track feature", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "project-1",
        type: StakworkRunType.REQUIREMENTS,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        result: "Requirements result",
        feature: {
          createdById: "user-1",
          isFastTrack: true,
          title: "Bug Fix Feature",
        },
        workspace: {
          slug: "test-workspace",
          ownerId: "user-1",
          sphinxEnabled: false,
          sphinxChatPubkey: null,
          sphinxBotId: null,
          sphinxBotSecret: null,
        },
      };

      // Mock workspace query for createStakworkRun
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "ADMIN" }],
        swarm: {
          swarmUrl: "https://swarm.example.com",
          swarmApiKey: "encrypted-key",
          swarmSecretAlias: "secret-alias",
          poolName: "test-pool",
          id: "swarm-1",
        },
        sourceControlOrg: {
          tokens: [{ token: "encrypted-token" }],
        },
        repositories: [
          {
            id: "repo-1",
            name: "test-repo",
            repositoryUrl: "https://github.com/test/repo",
            branch: "main",
          },
        ],
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.COMPLETED });
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue({
        id: "run-2",
        type: StakworkRunType.ARCHITECTURE,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        status: WorkflowStatus.PENDING,
      });
      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue({
        id: "user-1",
        githubAuth: { githubUsername: "testuser" },
      });
      mockedDb.feature.findFirst = vi.fn().mockResolvedValue({
        id: "feature-1",
        title: "Bug Fix",
        brief: "Fix bug",
        phases: [],
      });
      mockedStakworkService.mockReturnValue({
        triggerWorkflow: vi.fn().mockResolvedValue({ project_id: "project-2" }),
      } as any);
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      await processStakworkRunWebhook(
        {
          project_id: "project-1",
          project_status: "completed",
          result: "Requirements result",
        },
        {
          workspace_id: "ws-1",
          feature_id: "feature-1",
          type: "REQUIREMENTS",
        }
      );

      // Verify that a new run was created with the correct type
      expect(db.stakworkRun.create).toHaveBeenCalled();
      const createCall = vi.mocked(db.stakworkRun.create).mock.calls[0][0];
      expect(createCall.data).toMatchObject({
        type: StakworkRunType.ARCHITECTURE,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
      });
    });

    test("should trigger TASK_GENERATION run when ARCHITECTURE completes on fast-track feature", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "project-1",
        type: StakworkRunType.ARCHITECTURE,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        result: "Architecture result",
        feature: {
          createdById: "user-1",
          isFastTrack: true,
          title: "Bug Fix Feature",
        },
        workspace: {
          slug: "test-workspace",
          ownerId: "user-1",
          sphinxEnabled: false,
          sphinxChatPubkey: null,
          sphinxBotId: null,
          sphinxBotSecret: null,
        },
      };

      // Mock workspace query for createStakworkRun
      const mockWorkspace = {
        id: "ws-1",
        ownerId: "user-1",
        deleted: false,
        members: [{ role: "ADMIN" }],
        swarm: {
          swarmUrl: "https://swarm.example.com",
          swarmApiKey: "encrypted-key",
          swarmSecretAlias: "secret-alias",
          poolName: "test-pool",
          id: "swarm-1",
        },
        sourceControlOrg: {
          tokens: [{ token: "encrypted-token" }],
        },
        repositories: [
          {
            id: "repo-1",
            name: "test-repo",
            repositoryUrl: "https://github.com/test/repo",
            branch: "main",
          },
        ],
      };

      // First call: webhook lookup finds the ARCHITECTURE run.
      // Second call: TASK_GENERATION duplicate guard — no active run exists yet.
      mockedDb.stakworkRun.findFirst = vi.fn()
        .mockResolvedValueOnce(mockRun)
        .mockResolvedValue(null);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.COMPLETED });
      mockedDb.stakworkRun.create = vi.fn().mockResolvedValue({
        id: "run-2",
        type: StakworkRunType.TASK_GENERATION,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        status: WorkflowStatus.PENDING,
      });
      mockedDb.workspace.findUnique = vi.fn().mockResolvedValue(mockWorkspace);
      mockedDb.user.findUnique = vi.fn().mockResolvedValue({
        id: "user-1",
        githubAuth: { githubUsername: "testuser" },
      });
      mockedDb.feature.findFirst = vi.fn().mockResolvedValue({
        id: "feature-1",
        title: "Bug Fix",
        brief: "Fix bug",
        phases: [],
      });
      mockedStakworkService.mockReturnValue({
        triggerWorkflow: vi.fn().mockResolvedValue({ project_id: "project-2" }),
      } as any);
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      await processStakworkRunWebhook(
        {
          project_id: "project-1",
          project_status: "completed",
          result: "Architecture result",
        },
        {
          workspace_id: "ws-1",
          feature_id: "feature-1",
          type: "ARCHITECTURE",
        }
      );

      // Verify that a new run was created with the correct type
      expect(db.stakworkRun.create).toHaveBeenCalled();
      const createCall = vi.mocked(db.stakworkRun.create).mock.calls[0][0];
      expect(createCall.data).toMatchObject({
        type: StakworkRunType.TASK_GENERATION,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
      });
    });

    test("should NOT trigger next run when TASK_GENERATION completes", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "project-1",
        type: StakworkRunType.TASK_GENERATION,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        result: JSON.stringify({ phases: [{ tasks: [] }] }),
        feature: {
          createdById: "user-1",
          isFastTrack: true,
          title: "Bug Fix Feature",
        },
        workspace: {
          slug: "test-workspace",
          ownerId: "user-1",
          sphinxEnabled: false,
          sphinxChatPubkey: null,
          sphinxBotId: null,
          sphinxBotSecret: null,
        },
      };

      const mockFeature = {
        id: "feature-1",
        isFastTrack: true,
        phases: [{
          id: "phase-1",
          order: 1,
        }],
        workspace: {
          id: "ws-1",
        },
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.COMPLETED });
      mockedDb.feature.findUnique = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.feature.update = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.repository.findMany = vi.fn().mockResolvedValue([]);
      mockedDb.task.create = vi.fn().mockResolvedValue({ id: "task-1" });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const createSpy = vi.spyOn(db.stakworkRun, "create");

      await processStakworkRunWebhook(
        {
          project_id: "project-1",
          project_status: "completed",
          result: JSON.stringify({ phases: [{ tasks: [] }] }),
        },
        {
          workspace_id: "ws-1",
          feature_id: "feature-1",
          type: "TASK_GENERATION",
        }
      );

      // Verify no additional run was created (chain ends)
      expect(createSpy).not.toHaveBeenCalled();
    });

    test("should NOT trigger chain when autoAccept is false", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "project-1",
        type: StakworkRunType.REQUIREMENTS,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: false, // Not auto-accept
        result: "Requirements result",
        feature: {
          createdById: "user-1",
          isFastTrack: true,
          title: "Bug Fix Feature",
        },
        workspace: {
          slug: "test-workspace",
          ownerId: "user-1",
          sphinxEnabled: false,
          sphinxChatPubkey: null,
          sphinxBotId: null,
          sphinxBotSecret: null,
        },
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.COMPLETED });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const createSpy = vi.spyOn(db.stakworkRun, "create");

      await processStakworkRunWebhook(
        {
                    project_id: "project-1",
          project_status: "completed",
          result: "Requirements result",
        },
        {
          workspace_id: "ws-1",
          feature_id: "feature-1",
          type: "REQUIREMENTS",
        }
      );

      expect(createSpy).not.toHaveBeenCalled();
    });

    test("should NOT trigger chain when isFastTrack is false", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "project-1",
        type: StakworkRunType.REQUIREMENTS,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        result: "Requirements result",
        feature: {
          createdById: "user-1",
          isFastTrack: false, // Not fast-track
          title: "Regular Feature",
        },
        workspace: {
          slug: "test-workspace",
          ownerId: "user-1",
          sphinxEnabled: false,
          sphinxChatPubkey: null,
          sphinxBotId: null,
          sphinxBotSecret: null,
        },
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.COMPLETED });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const createSpy = vi.spyOn(db.stakworkRun, "create");

      await processStakworkRunWebhook(
        {
                    project_id: "project-1",
          project_status: "completed",
          result: "Requirements result",
        },
        {
          workspace_id: "ws-1",
          feature_id: "feature-1",
          type: "REQUIREMENTS",
        }
      );

      expect(createSpy).not.toHaveBeenCalled();
    });

    test("should handle chain creation errors gracefully", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "project-1",
        type: StakworkRunType.REQUIREMENTS,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        result: "Requirements result",
        feature: {
          createdById: "user-1",
          isFastTrack: true,
          title: "Bug Fix Feature",
        },
        workspace: {
          slug: "test-workspace",
          ownerId: "user-1",
          sphinxEnabled: false,
          sphinxChatPubkey: null,
          sphinxBotId: null,
          sphinxBotSecret: null,
        },
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.COMPLETED });
      mockedDb.stakworkRun.create = vi.fn().mockRejectedValue(new Error("Chain creation failed"));
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      // Should not throw
      await expect(processStakworkRunWebhook(
        {
          project_id: "project-1",
          project_status: "completed",
          result: "Requirements result",
        },
        {
          workspace_id: "ws-1",
          feature_id: "feature-1",
          type: "REQUIREMENTS",
        }
      )).resolves.toBeDefined();
    });
  });

  describe("Sphinx Failure Notification", () => {
    beforeEach(() => {
      vi.mock("@/lib/sphinx/daily-pr-summary", () => ({
        sendToSphinx: vi.fn().mockResolvedValue({}),
      }));
    });

    test("should send Sphinx notification when fast-track run fails with all requirements met", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "project-1",
        type: StakworkRunType.REQUIREMENTS,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        result: null,
        feature: {
          createdById: "user-1",
          isFastTrack: true,
          title: "Bug Fix Feature",
        },
        workspace: {
          slug: "test-workspace",
          ownerId: "user-1",
          sphinxEnabled: true,
          sphinxChatPubkey: "chat-pubkey-123",
          sphinxBotId: "bot-id-123",
          sphinxBotSecret: "encrypted-secret",
        },
      };

      const mockCreator = {
        id: "user-1",
        sphinxAlias: "developer-alias",
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.FAILED });
      mockedDb.user.findUnique = vi.fn().mockResolvedValue(mockCreator);
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const { sendToSphinx } = await import("@/lib/sphinx/daily-pr-summary");
      const sendToSphinxMock = vi.mocked(sendToSphinx);

      await processStakworkRunWebhook(
        {
          project_id: "project-1",
          project_status: "failed",
          result: null,
        },
        {
          workspace_id: "ws-1",
          feature_id: "feature-1",
          type: "REQUIREMENTS",
        }
      );

      // Check that user.findUnique was called to fetch sphinxAlias
      const userFindCalls = vi.mocked(db.user.findUnique).mock.calls;
      const sphinxAliasCalls = userFindCalls.filter(call => 
        call[0].select && 'sphinxAlias' in call[0].select
      );
      expect(sphinxAliasCalls.length).toBeGreaterThan(0);

      expect(sendToSphinxMock).toHaveBeenCalledWith(
        {
          chatPubkey: "chat-pubkey-123",
          botId: "bot-id-123",
          botSecret: "decrypted-sphinxBotSecret",
        },
        expect.stringContaining("Fast Track bug fix for 'Bug Fix Feature' has stalled")
      );
    });

    test("should NOT send notification when sphinxEnabled is false", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "project-1",
        type: StakworkRunType.REQUIREMENTS,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        result: null,
        feature: {
          createdById: "user-1",
          isFastTrack: true,
          title: "Bug Fix Feature",
        },
        workspace: {
          slug: "test-workspace",
          ownerId: "user-1",
          sphinxEnabled: false, // Disabled
          sphinxChatPubkey: "chat-pubkey-123",
          sphinxBotId: "bot-id-123",
          sphinxBotSecret: "encrypted-secret",
        },
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.FAILED });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const { sendToSphinx } = await import("@/lib/sphinx/daily-pr-summary");
      const sendToSphinxMock = vi.mocked(sendToSphinx);

      await processStakworkRunWebhook(
        {
                    project_id: "project-1",
          project_status: "failed",
          result: null,
        },
        {
          workspace_id: "ws-1",
          feature_id: "feature-1",
          type: "REQUIREMENTS",
        }
      );

      expect(sendToSphinxMock).not.toHaveBeenCalled();
    });

    test("should NOT send notification when creator has no sphinxAlias", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "project-1",
        type: StakworkRunType.REQUIREMENTS,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        result: null,
        feature: {
          createdById: "user-1",
          isFastTrack: true,
          title: "Bug Fix Feature",
        },
        workspace: {
          slug: "test-workspace",
          ownerId: "user-1",
          sphinxEnabled: true,
          sphinxChatPubkey: "chat-pubkey-123",
          sphinxBotId: "bot-id-123",
          sphinxBotSecret: "encrypted-secret",
        },
      };

      const mockCreator = {
        id: "user-1",
        sphinxAlias: null, // No Sphinx alias
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.FAILED });
      mockedDb.user.findUnique = vi.fn().mockResolvedValue(mockCreator);
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const { sendToSphinx } = await import("@/lib/sphinx/daily-pr-summary");
      const sendToSphinxMock = vi.mocked(sendToSphinx);

      await processStakworkRunWebhook(
        {
                    project_id: "project-1",
          project_status: "failed",
          result: null,
        },
        {
          workspace_id: "ws-1",
          feature_id: "feature-1",
          type: "REQUIREMENTS",
        }
      );

      expect(sendToSphinxMock).not.toHaveBeenCalled();
    });

    test("should handle Sphinx notification errors gracefully", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "project-1",
        type: StakworkRunType.REQUIREMENTS,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        result: null,
        feature: {
          createdById: "user-1",
          isFastTrack: true,
          title: "Bug Fix Feature",
        },
        workspace: {
          slug: "test-workspace",
          ownerId: "user-1",
          sphinxEnabled: true,
          sphinxChatPubkey: "chat-pubkey-123",
          sphinxBotId: "bot-id-123",
          sphinxBotSecret: "encrypted-secret",
        },
      };

      const mockCreator = {
        id: "user-1",
        sphinxAlias: "developer-alias",
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.FAILED });
      mockedDb.user.findUnique = vi.fn().mockResolvedValue(mockCreator);
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const { sendToSphinx } = await import("@/lib/sphinx/daily-pr-summary");
      vi.mocked(sendToSphinx).mockRejectedValue(new Error("Sphinx API error"));

      // Should not throw
      await expect(processStakworkRunWebhook(
        {
          project_id: "project-1",
          project_status: "failed",
          result: null,
        },
        {
          workspace_id: "ws-1",
          feature_id: "feature-1",
          type: "REQUIREMENTS",
        }
      )).resolves.toBeDefined();
    });

    test("should NOT send notification for non-fast-track features", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "project-1",
        type: StakworkRunType.REQUIREMENTS,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        result: null,
        feature: {
          createdById: "user-1",
          isFastTrack: false, // Not fast-track
          title: "Regular Feature",
        },
        workspace: {
          slug: "test-workspace",
          ownerId: "user-1",
          sphinxEnabled: true,
          sphinxChatPubkey: "chat-pubkey-123",
          sphinxBotId: "bot-id-123",
          sphinxBotSecret: "encrypted-secret",
        },
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.FAILED });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const { sendToSphinx } = await import("@/lib/sphinx/daily-pr-summary");
      const sendToSphinxMock = vi.mocked(sendToSphinx);

      await processStakworkRunWebhook(
        {
                    project_id: "project-1",
          project_status: "failed",
          result: null,
        },
        {
          workspace_id: "ws-1",
          feature_id: "feature-1",
          type: "REQUIREMENTS",
        }
      );

      expect(sendToSphinxMock).not.toHaveBeenCalled();
    });
  });

  describe("Fast Track Task Creation", () => {
    test("should create tasks with autoMerge and systemAssigneeType when isFastTrack is true", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "project-1",
        type: StakworkRunType.TASK_GENERATION,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        result: JSON.stringify({
          phases: [{
            tasks: [{
              tempId: "temp-1",
              title: "Fix bug",
              description: "Fix the reported bug",
              priority: "HIGH",
              dependsOn: [],
            }]
          }]
        }),
        feature: {
          createdById: "user-1",
          isFastTrack: true,
          title: "Bug Fix Feature",
        },
        workspace: {
          slug: "test-workspace",
          ownerId: "user-1",
          sphinxEnabled: false,
          sphinxChatPubkey: null,
          sphinxBotId: null,
          sphinxBotSecret: null,
        },
      };

      const mockFeature = {
        id: "feature-1",
        isFastTrack: true,
        phases: [{
          id: "phase-1",
          order: 1,
        }],
        workspace: {
          id: "ws-1",
        },
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.COMPLETED });
      mockedDb.feature.findUnique = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.feature.update = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.repository.findMany = vi.fn().mockResolvedValue([{ id: "repo-1", repositoryUrl: "https://github.com/test/repo" }]);
      mockedDb.task.create = vi.fn().mockResolvedValue({ id: "task-1" });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      await processStakworkRunWebhook(
        {
                    project_id: "project-1",
          project_status: "completed",
          result: mockRun.result,
        },
        {
          workspace_id: "ws-1",
          feature_id: "feature-1",
          type: "REQUIREMENTS",
        }
      );

      expect(db.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "Fix bug",
          autoMerge: true,
          systemAssigneeType: "TASK_COORDINATOR",
        }),
      });
    });

    test("should create tasks WITHOUT autoMerge when isFastTrack is false", async () => {
      const mockRun = {
        id: "run-1",
        projectId: "project-1",
        type: StakworkRunType.TASK_GENERATION,
        workspaceId: "ws-1",
        featureId: "feature-1",
        autoAccept: true,
        result: JSON.stringify({
          phases: [{
            tasks: [{
              tempId: "temp-1",
              title: "Regular task",
              description: "Regular task description",
              priority: "MEDIUM",
              dependsOn: [],
            }]
          }]
        }),
        feature: {
          createdById: "user-1",
          isFastTrack: false, // Not fast-track
          title: "Regular Feature",
        },
        workspace: {
          slug: "test-workspace",
          ownerId: "user-1",
          sphinxEnabled: false,
          sphinxChatPubkey: null,
          sphinxBotId: null,
          sphinxBotSecret: null,
        },
      };

      const mockFeature = {
        id: "feature-1",
        isFastTrack: false,
        phases: [{
          id: "phase-1",
          order: 1,
        }],
        workspace: {
          id: "ws-1",
        },
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.COMPLETED });
      mockedDb.feature.findUnique = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.feature.update = vi.fn().mockResolvedValue(mockFeature);
      mockedDb.repository.findMany = vi.fn().mockResolvedValue([{ id: "repo-1", repositoryUrl: "https://github.com/test/repo" }]);
      mockedDb.task.create = vi.fn().mockResolvedValue({ id: "task-1" });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      await processStakworkRunWebhook(
        {
                    project_id: "project-1",
          project_status: "completed",
          result: mockRun.result,
        },
        {
          workspace_id: "ws-1",
          feature_id: "feature-1",
          type: "REQUIREMENTS",
        }
      );

      expect(db.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "Regular task",
          autoMerge: undefined,
          systemAssigneeType: undefined,
        }),
      });
    });
  });

  describe("TASK_GENERATION branch", () => {
    const baseRun = {
      id: "run-1",
      projectId: "project-1",
      type: StakworkRunType.TASK_GENERATION,
      workspaceId: "ws-1",
      featureId: "feature-1",
      autoAccept: true,
      feature: {
        createdById: "user-1",
        isFastTrack: false,
        title: "Branch Test Feature",
      },
      workspace: {
        slug: "test-workspace",
        ownerId: "user-1",
        sphinxEnabled: false,
        sphinxChatPubkey: null,
        sphinxBotId: null,
        sphinxBotSecret: null,
      },
    };

    const baseFeature = {
      id: "feature-1",
      isFastTrack: false,
      phases: [{ id: "phase-1", order: 1 }],
      workspace: { id: "ws-1" },
    };

    test("should store branch on task when branch is provided in payload", async () => {
      const mockRun = {
        ...baseRun,
        result: JSON.stringify({
          phases: [{
            tasks: [{
              tempId: "temp-1",
              title: "Branched task",
              description: "Task with branch",
              priority: "MEDIUM",
              dependsOn: [],
              branch: "feature/my-branch",
            }]
          }]
        }),
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.COMPLETED });
      mockedDb.feature.findUnique = vi.fn().mockResolvedValue(baseFeature);
      mockedDb.feature.update = vi.fn().mockResolvedValue(baseFeature);
      mockedDb.repository.findMany = vi.fn().mockResolvedValue([{ id: "repo-1", repositoryUrl: "https://github.com/test/repo" }]);
      mockedDb.task.create = vi.fn().mockResolvedValue({ id: "task-1" });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      await processStakworkRunWebhook(
        { project_id: "project-1", project_status: "completed", result: mockRun.result },
        { workspace_id: "ws-1", feature_id: "feature-1", type: "REQUIREMENTS" }
      );

      expect(db.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ branch: "feature/my-branch" }),
      });
    });

    test("should store branch as null when branch is omitted from payload", async () => {
      const mockRun = {
        ...baseRun,
        result: JSON.stringify({
          phases: [{
            tasks: [{
              tempId: "temp-1",
              title: "Branchless task",
              description: "Task without branch",
              priority: "MEDIUM",
              dependsOn: [],
            }]
          }]
        }),
      };

      mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue(mockRun);
      mockedDb.stakworkRun.update = vi.fn().mockResolvedValue({ ...mockRun, status: WorkflowStatus.COMPLETED });
      mockedDb.feature.findUnique = vi.fn().mockResolvedValue(baseFeature);
      mockedDb.feature.update = vi.fn().mockResolvedValue(baseFeature);
      mockedDb.repository.findMany = vi.fn().mockResolvedValue([{ id: "repo-1", repositoryUrl: "https://github.com/test/repo" }]);
      mockedDb.task.create = vi.fn().mockResolvedValue({ id: "task-1" });
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      await processStakworkRunWebhook(
        { project_id: "project-1", project_status: "completed", result: mockRun.result },
        { workspace_id: "ws-1", feature_id: "feature-1", type: "REQUIREMENTS" }
      );

      expect(db.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ branch: null }),
      });
    });
  });

});
