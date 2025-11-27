import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  getOrCreateJanitorConfig,
  updateJanitorConfig,
  createJanitorRun,
  getJanitorRuns,
  getJanitorRecommendations,
  acceptJanitorRecommendation,
  dismissJanitorRecommendation,
  processJanitorWebhook,
} from "@/services/janitor";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { createTaskWithStakworkWorkflow } from "@/services/task-workflow";
import { stakworkService } from "@/lib/service-factory";
import { config as envConfig } from "@/lib/env";
import { pusherServer } from "@/lib/pusher";
import { JANITOR_ERRORS } from "@/lib/constants/janitor";
import { janitorMocks, janitorMockSetup, TEST_DATE_ISO } from "@/__tests__/support/helpers/service-mocks/janitor-mocks";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

vi.mock("@/services/workspace");
vi.mock("@/services/task-workflow");
vi.mock("@/lib/service-factory");
vi.mock("@/lib/auth/nextauth");
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    RECOMMENDATIONS_UPDATED: "recommendations-updated",
  },
}));
vi.mock("@/lib/db");

const mockedDb = vi.mocked(db);
const mockedValidateWorkspaceAccess = vi.mocked(validateWorkspaceAccess);
const mockedCreateTaskWithStakworkWorkflow = vi.mocked(createTaskWithStakworkWorkflow);
const mockedPusherServer = vi.mocked(pusherServer);
const mockedGetGithubUsernameAndPAT = vi.mocked(getGithubUsernameAndPAT);

describe("Janitor Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock database methods manually
    Object.assign(db, {
      $transaction: vi.fn((callback: any) => callback(mockedDb)),
      janitorConfig: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      janitorRun: {
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
      },
      janitorRecommendation: {
        findMany: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      workspaceMember: {
        findFirst: vi.fn(),
      },
      repository: {
        findFirst: vi.fn(),
      },
    });

    // Mock getGithubUsernameAndPAT to return test credentials
    mockedGetGithubUsernameAndPAT.mockResolvedValue({
      username: "test-user",
      token: "ghp_test_token_123",
    });
  });

  describe("getOrCreateJanitorConfig", () => {
    test("should return existing config when found", async () => {
      const mockConfig = janitorMocks.createMockConfig();
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigExists(mockedDb, mockConfig);

      const result = await getOrCreateJanitorConfig("test-workspace", "user-1");

      expect(validateWorkspaceAccess).toHaveBeenCalledWith("test-workspace", "user-1");
      expect(db.janitorConfig.findUnique).toHaveBeenCalledWith({
        where: { workspaceId: "ws-1" },
      });
      expect(db.janitorConfig.create).not.toHaveBeenCalled();
      expect(result).toEqual(mockConfig);
    });

    test("should create new config when not found", async () => {
      const mockConfig = janitorMocks.createMockConfig();
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigCreate(mockedDb, mockConfig);

      const result = await getOrCreateJanitorConfig("test-workspace", "user-1");

      expect(db.janitorConfig.findUnique).toHaveBeenCalledWith({
        where: { workspaceId: "ws-1" },
      });
      expect(db.janitorConfig.create).toHaveBeenCalledWith({
        data: { workspaceId: "ws-1" },
      });
      expect(result).toEqual(mockConfig);
    });

    test("should throw error when workspace not found", async () => {
      const mockValidation = {
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);

      await expect(getOrCreateJanitorConfig("non-existent", "user-1")).rejects.toThrow(
        JANITOR_ERRORS.WORKSPACE_NOT_FOUND
      );

      expect(db.janitorConfig.findUnique).not.toHaveBeenCalled();
    });

    test("should throw error when user lacks read permission", async () => {
      const mockValidation = {
        hasAccess: true,
        canRead: false,
        canWrite: false,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);

      await expect(getOrCreateJanitorConfig("test-workspace", "user-1")).rejects.toThrow(
        JANITOR_ERRORS.WORKSPACE_NOT_FOUND
      );
    });
  });

  describe("updateJanitorConfig", () => {
    test("should update existing config successfully", async () => {
      const mockConfig = janitorMocks.createMockConfig();
      const updatedConfig = janitorMocks.createMockConfig({
        unitTestsEnabled: true,
        integrationTestsEnabled: true,
      });
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigExists(mockedDb, mockConfig);
      janitorMockSetup.mockConfigUpdate(mockedDb, updatedConfig);

      const updateData = {
        unitTestsEnabled: true,
        integrationTestsEnabled: true,
      };

      const result = await updateJanitorConfig("test-workspace", "user-1", updateData);

      expect(validateWorkspaceAccess).toHaveBeenCalledWith("test-workspace", "user-1");
      expect(db.janitorConfig.update).toHaveBeenCalledWith({
        where: { id: mockConfig.id },
        data: updateData,
      });
      expect(result).toEqual(updatedConfig);
    });

    test("should create config if not found then update", async () => {
      const mockConfig = janitorMocks.createMockConfig();
      const updatedConfig = janitorMocks.createMockConfig({
        unitTestsEnabled: true,
      });
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigNotFound(mockedDb);
      vi.mocked(db.janitorConfig.create).mockResolvedValue(mockConfig);
      janitorMockSetup.mockConfigUpdate(mockedDb, updatedConfig);

      const updateData = { unitTestsEnabled: true };
      const result = await updateJanitorConfig("test-workspace", "user-1", updateData);

      expect(db.janitorConfig.create).toHaveBeenCalledWith({
        data: { workspaceId: "ws-1" },
      });
      expect(db.janitorConfig.update).toHaveBeenCalledWith({
        where: { id: mockConfig.id },
        data: updateData,
      });
      expect(result).toEqual(updatedConfig);
    });

    test("should throw error when user lacks admin permission", async () => {
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);

      await expect(
        updateJanitorConfig("test-workspace", "user-1", { unitTestsEnabled: true })
      ).rejects.toThrow(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);

      expect(db.janitorConfig.findUnique).not.toHaveBeenCalled();
    });

    test("should throw error when workspace not found", async () => {
      const mockValidation = {
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);

      await expect(
        updateJanitorConfig("non-existent", "user-1", { unitTestsEnabled: true })
      ).rejects.toThrow(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);
    });
  });

  describe("createJanitorRun", () => {
    test("should create janitor run successfully", async () => {
      const mockConfig = janitorMocks.createMockConfig({ unitTestsEnabled: true });
      const mockRun = janitorMocks.createMockRunWithConfig(
        { status: "RUNNING", stakworkProjectId: 12345 },
        { unitTestsEnabled: true }
      );
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigExists(mockedDb, mockConfig);
      vi.mocked(db.janitorRun.create)
        .mockResolvedValueOnce({
          ...mockRun,
          status: "PENDING",
          stakworkProjectId: null,
        } as any)
        .mockResolvedValueOnce(mockRun as any);
      vi.mocked(db.janitorRun.update).mockResolvedValue(mockRun as any);

      // Mock stakwork service
      const mockStakworkRequest = vi.fn().mockResolvedValue({
        data: { project_id: 12345 },
      });
      vi.mocked(stakworkService).mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      const result = await createJanitorRun("test-workspace", "user-1", "UNIT_TESTS");

      expect(validateWorkspaceAccess).toHaveBeenCalledWith("test-workspace", "user-1");
      expect(db.janitorConfig.findUnique).toHaveBeenCalledWith({
        where: { workspaceId: "ws-1" },
      });
      expect(db.janitorRun.create).toHaveBeenCalled();
      expect(db.janitorRun.update).toHaveBeenCalledWith({
        where: { id: mockRun.id },
        data: {
          stakworkProjectId: 12345,
          status: "RUNNING",
          startedAt: expect.any(Date),
        },
        include: expect.any(Object),
      });
      
      // Verify ignoreDirs is included in the Stakwork payload
      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          workflow_params: expect.objectContaining({
            set_var: expect.objectContaining({
              attributes: expect.objectContaining({
                vars: expect.objectContaining({
                  ignoreDirs: "node_modules,dist",
                }),
              }),
            }),
          }),
        })
      );
      
      expect(result.status).toBe("RUNNING");
      expect(result.stakworkProjectId).toBe(12345);
    });

    test("should create MOCK_GENERATION janitor run successfully", async () => {
      const mockConfig = janitorMocks.createMockConfig({ mockGenerationEnabled: true });
      const mockRun = janitorMocks.createMockRunWithConfig(
        { status: "RUNNING", stakworkProjectId: 12345, janitorType: "MOCK_GENERATION" },
        { mockGenerationEnabled: true }
      );
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigExists(mockedDb, mockConfig);
      vi.mocked(db.janitorRun.create)
        .mockResolvedValueOnce({
          ...mockRun,
          status: "PENDING",
          stakworkProjectId: null,
        } as any)
        .mockResolvedValueOnce(mockRun as any);
      vi.mocked(db.janitorRun.update).mockResolvedValue(mockRun as any);

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        data: { project_id: 12345 },
      });
      vi.mocked(stakworkService).mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      const result = await createJanitorRun("test-workspace", "user-1", "MOCK_GENERATION");

      expect(result.status).toBe("RUNNING");
      expect(result.stakworkProjectId).toBe(12345);
      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          workflow_params: expect.objectContaining({
            set_var: expect.objectContaining({
              attributes: expect.objectContaining({
                vars: expect.objectContaining({
                  janitorType: "MOCK_GENERATION",
                }),
              }),
            }),
          }),
        })
      );
    });

    test("should throw error for invalid janitor type", async () => {
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);

      await expect(
        createJanitorRun("test-workspace", "user-1", "INVALID_TYPE")
      ).rejects.toThrow("Invalid janitor type: INVALID_TYPE");
    });

    test("should throw error when janitor type is disabled", async () => {
      const mockConfig = janitorMocks.createMockConfig({
        unitTestsEnabled: false,
      });
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigExists(mockedDb, mockConfig);

      await expect(
        createJanitorRun("test-workspace", "user-1", "UNIT_TESTS")
      ).rejects.toThrow(JANITOR_ERRORS.JANITOR_DISABLED);
    });

    test("should throw error when user lacks write permission", async () => {
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: false,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);

      await expect(
        createJanitorRun("test-workspace", "user-1", "UNIT_TESTS")
      ).rejects.toThrow(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);
    });

    test("should handle Stakwork integration failure", async () => {
      const mockConfig = janitorMocks.createMockConfig({ unitTestsEnabled: true });
      const mockRun = janitorMocks.createMockRunWithConfig({}, { unitTestsEnabled: true });
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigExists(mockedDb, mockConfig);
      vi.mocked(db.janitorRun.create).mockResolvedValue(mockRun as any);
      vi.mocked(db.janitorRun.update).mockResolvedValue({} as any);

      // Mock stakwork service failure
      vi.mocked(stakworkService).mockReturnValue({
        stakworkRequest: vi.fn().mockRejectedValue(new Error("Stakwork API error")),
      } as any);

      await expect(
        createJanitorRun("test-workspace", "user-1", "UNIT_TESTS")
      ).rejects.toThrow("Failed to start janitor run: Stakwork API error");

      expect(db.janitorRun.update).toHaveBeenCalledWith({
        where: { id: mockRun.id },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: expect.stringContaining("Stakwork API error"),
        },
      });
    });
  });

  describe("getJanitorRuns", () => {
    test("should return paginated janitor runs", async () => {
      const mockConfig = janitorMocks.createMockConfig();
      const mockRuns = [
        janitorMocks.createMockRun({ id: "run-1", status: "COMPLETED" }),
        janitorMocks.createMockRun({ id: "run-2", status: "RUNNING" }),
      ];
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigExists(mockedDb, mockConfig);
      janitorMockSetup.mockRunFindMany(mockedDb, mockRuns, 2);

      const result = await getJanitorRuns("test-workspace", "user-1");

      expect(db.janitorRun.findMany).toHaveBeenCalledWith({
        where: { janitorConfigId: mockConfig.id },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 10,
        include: {
          _count: {
            select: { recommendations: true },
          },
        },
      });
      expect(result.runs).toHaveLength(2);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
    });

    test("should filter runs by type and status", async () => {
      const mockConfig = janitorMocks.createMockConfig();
      const mockRuns = [janitorMocks.createMockRun({ janitorType: "UNIT_TESTS", status: "COMPLETED" })];
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigExists(mockedDb, mockConfig);
      janitorMockSetup.mockRunFindMany(mockedDb, mockRuns, 1);

      const result = await getJanitorRuns("test-workspace", "user-1", {
        type: "UNIT_TESTS",
        status: "COMPLETED",
        limit: 5,
        page: 1,
      });

      expect(db.janitorRun.findMany).toHaveBeenCalledWith({
        where: {
          janitorConfigId: mockConfig.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
        },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 5,
        include: expect.any(Object),
      });
      expect(result.runs).toHaveLength(1);
    });

    test("should handle pagination correctly", async () => {
      const mockConfig = janitorMocks.createMockConfig();
      const mockRuns = [janitorMocks.createMockRun()];
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigExists(mockedDb, mockConfig);
      janitorMockSetup.mockRunFindMany(mockedDb, mockRuns, 25);

      const result = await getJanitorRuns("test-workspace", "user-1", {
        limit: 10,
        page: 2,
      });

      expect(db.janitorRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        })
      );
      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
    });

    test("should throw error when user lacks read permission", async () => {
      const mockValidation = {
        hasAccess: true,
        canRead: false,
        canWrite: false,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);

      await expect(getJanitorRuns("test-workspace", "user-1")).rejects.toThrow(
        JANITOR_ERRORS.WORKSPACE_NOT_FOUND
      );
    });
  });

  describe("getJanitorRecommendations", () => {
    test("should return paginated recommendations with default PENDING filter", async () => {
      const mockConfig = janitorMocks.createMockConfig();
      const mockRecommendations = [
        janitorMocks.createMockRecommendationWithRun({ status: "PENDING", priority: "HIGH" }),
        janitorMocks.createMockRecommendationWithRun({ status: "PENDING", priority: "MEDIUM" }),
      ];
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigExists(mockedDb, mockConfig);
      janitorMockSetup.mockRecommendationFindMany(mockedDb, mockRecommendations, 2);

      const result = await getJanitorRecommendations("test-workspace", "user-1");

      expect(db.janitorRecommendation.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: mockValidation.workspace.id,
          status: "PENDING",
        },
        orderBy: [
          { status: "asc" },
          { priority: "desc" },
          { createdAt: "desc" },
        ],
        skip: 0,
        take: 10,
        include: expect.any(Object),
      });
      expect(result.recommendations).toHaveLength(2);
    });

    test("should filter recommendations by status, type, and priority", async () => {
      const mockConfig = janitorMocks.createMockConfig();
      const mockRecommendations = [
        janitorMocks.createMockRecommendationWithRun(
          { status: "ACCEPTED", priority: "HIGH" },
          { janitorType: "UNIT_TESTS" }
        ),
      ];
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigExists(mockedDb, mockConfig);
      janitorMockSetup.mockRecommendationFindMany(mockedDb, mockRecommendations, 1);

      const result = await getJanitorRecommendations("test-workspace", "user-1", {
        status: "ACCEPTED",
        janitorType: "UNIT_TESTS",
        priority: "HIGH",
      });

      expect(db.janitorRecommendation.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: mockValidation.workspace.id,
          janitorRun: {
            janitorType: "UNIT_TESTS",
          },
          status: "ACCEPTED",
          priority: "HIGH",
        },
        orderBy: expect.any(Array),
        skip: 0,
        take: 10,
        include: expect.any(Object),
      });
    });

    test("should return empty array when config not found", async () => {
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockConfigNotFound(mockedDb);

      const result = await getJanitorRecommendations("test-workspace", "user-1");

      expect(result.recommendations).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });
  });

  describe("acceptJanitorRecommendation", () => {
    test("should accept recommendation and create task successfully", async () => {
      const mockRecommendation = {
        ...janitorMocks.createMockRecommendation({ status: "PENDING" }),
        janitorRun: {
          id: "run-1",
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          janitorConfig: {
            id: "config-1",
            workspace: {
              id: "ws-1",
              slug: "test-workspace",
            },
          },
        },
      };
      const updatedRecommendation = janitorMocks.createMockRecommendation({
        status: "ACCEPTED",
        acceptedAt: new Date(),
        acceptedById: "user-1",
      });
      const mockTask = {
        id: "task-1",
        title: mockRecommendation.title,
        status: "TODO",
      };
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test-workspace", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      // First findUnique call returns PENDING recommendation, second returns ACCEPTED
      const enrichedMockRecommendation = {
        ...mockRecommendation,
        workspace: mockRecommendation.janitorRun?.janitorConfig?.workspace,
        workspaceId: "ws-1",
      };
      const enrichedUpdatedRecommendation = {
        ...updatedRecommendation,
        workspace: mockRecommendation.janitorRun?.janitorConfig?.workspace,
        workspaceId: "ws-1",
      };
      vi.mocked(mockedDb.janitorRecommendation.findUnique)
        .mockResolvedValueOnce(enrichedMockRecommendation)
        .mockResolvedValueOnce(enrichedUpdatedRecommendation);
      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockRecommendationUpdate(mockedDb, updatedRecommendation);
      mockedCreateTaskWithStakworkWorkflow.mockResolvedValue({
        task: mockTask,
        stakworkResult: { project_id: 123 },
        chatMessage: { id: "msg-1" },
      } as any);

      const result = await acceptJanitorRecommendation("rec-1", "user-1");

      expect(db.janitorRecommendation.findUnique).toHaveBeenCalledWith({
        where: { id: "rec-1" },
        include: expect.any(Object),
      });
      expect(validateWorkspaceAccess).toHaveBeenCalledWith("test-workspace", "user-1");
      expect(db.janitorRecommendation.update).toHaveBeenCalledWith({
        where: { id: "rec-1" },
        data: {
          status: "ACCEPTED",
          acceptedAt: expect.any(Date),
          acceptedById: "user-1",
          metadata: expect.any(Object),
        },
      });
      expect(createTaskWithStakworkWorkflow).toHaveBeenCalledWith({
        title: mockRecommendation.title,
        description: mockRecommendation.description,
        workspaceId: "ws-1",
        assigneeId: undefined,
        repositoryId: undefined,
        priority: mockRecommendation.priority,
        sourceType: "JANITOR",
        userId: "user-1",
        mode: "live",
        autoMergePr: undefined,
        janitorType: "UNIT_TESTS",
      });
      expect(result.recommendation.status).toBe("ACCEPTED");
      expect(result.task).toEqual(mockTask);
    });

    test("should accept recommendation with assignee and repository", async () => {
      const mockRecommendation = {
        ...janitorMocks.createMockRecommendation({ status: "PENDING" }),
        janitorRun: {
          id: "run-1",
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          janitorConfig: {
            id: "config-1",
            workspace: {
              id: "ws-1",
              slug: "test-workspace",
            },
          },
        },
      };
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test-workspace", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      janitorMockSetup.mockRecommendationExists(mockedDb, mockRecommendation);
      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockWorkspaceMemberExists(mockedDb, true);
      janitorMockSetup.mockRepositoryExists(mockedDb, true);
      janitorMockSetup.mockRecommendationUpdate(mockedDb, mockRecommendation);
      mockedCreateTaskWithStakworkWorkflow.mockResolvedValue({
        task: { id: "task-1" },
        stakworkResult: {},
        chatMessage: {},
      } as any);

      await acceptJanitorRecommendation("rec-1", "user-1", {
        assigneeId: "assignee-1",
        repositoryId: "repo-1",
      });

      expect(db.workspaceMember.findFirst).toHaveBeenCalledWith({
        where: {
          userId: "assignee-1",
          workspaceId: "ws-1",
        },
      });
      expect(db.repository.findFirst).toHaveBeenCalledWith({
        where: {
          id: "repo-1",
          workspaceId: "ws-1",
        },
      });
    });

    test("should throw error when recommendation not found", async () => {
      janitorMockSetup.mockRecommendationNotFound(mockedDb);

      await expect(acceptJanitorRecommendation("rec-1", "user-1")).rejects.toThrow(
        JANITOR_ERRORS.RECOMMENDATION_NOT_FOUND
      );
    });

    test("should throw error when recommendation already processed", async () => {
      const mockRecommendation = {
        ...janitorMocks.createMockRecommendation({ status: "ACCEPTED" }),
        janitorRun: {
          id: "run-1",
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          janitorConfig: {
            id: "config-1",
            workspace: {
              id: "ws-1",
              slug: "test-workspace",
            },
          },
        },
      };

      janitorMockSetup.mockRecommendationExists(mockedDb, mockRecommendation);

      await expect(acceptJanitorRecommendation("rec-1", "user-1")).rejects.toThrow(
        JANITOR_ERRORS.RECOMMENDATION_ALREADY_PROCESSED
      );
    });

    test("should throw error when user lacks write permission", async () => {
      const mockRecommendation = {
        ...janitorMocks.createMockRecommendation({ status: "PENDING" }),
        janitorRun: {
          id: "run-1",
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          janitorConfig: {
            id: "config-1",
            workspace: {
              id: "ws-1",
              slug: "test-workspace",
            },
          },
        },
      };
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: false,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test-workspace", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      janitorMockSetup.mockRecommendationExists(mockedDb, mockRecommendation);
      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);

      await expect(acceptJanitorRecommendation("rec-1", "user-1")).rejects.toThrow(
        JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS
      );
    });

    test("should throw error when assignee is not workspace member", async () => {
      const mockRecommendation = {
        ...janitorMocks.createMockRecommendation({ status: "PENDING" }),
        janitorRun: {
          id: "run-1",
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          janitorConfig: {
            id: "config-1",
            workspace: {
              id: "ws-1",
              slug: "test-workspace",
            },
          },
        },
      };
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test-workspace", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      janitorMockSetup.mockRecommendationExists(mockedDb, mockRecommendation);
      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockWorkspaceMemberExists(mockedDb, false);

      await expect(
        acceptJanitorRecommendation("rec-1", "user-1", { assigneeId: "non-member" })
      ).rejects.toThrow(JANITOR_ERRORS.ASSIGNEE_NOT_MEMBER);
    });

    test("should throw error when repository not found", async () => {
      const mockRecommendation = {
        ...janitorMocks.createMockRecommendation({ status: "PENDING" }),
        janitorRun: {
          id: "run-1",
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          janitorConfig: {
            id: "config-1",
            workspace: {
              id: "ws-1",
              slug: "test-workspace",
            },
          },
        },
      };
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test-workspace", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      janitorMockSetup.mockRecommendationExists(mockedDb, mockRecommendation);
      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      janitorMockSetup.mockRepositoryExists(mockedDb, false);

      await expect(
        acceptJanitorRecommendation("rec-1", "user-1", { repositoryId: "non-existent" })
      ).rejects.toThrow(JANITOR_ERRORS.REPOSITORY_NOT_FOUND);
    });
  });

  describe("dismissJanitorRecommendation", () => {
    test("should dismiss recommendation successfully", async () => {
      const mockRecommendation = {
        ...janitorMocks.createMockRecommendation({ status: "PENDING" }),
        janitorRun: {
          id: "run-1",
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          janitorConfig: {
            id: "config-1",
            workspace: {
              id: "ws-1",
              slug: "test-workspace",
            },
          },
        },
      };
      const dismissedRecommendation = {
        ...janitorMocks.createMockRecommendation({
          status: "DISMISSED",
          dismissedAt: new Date(),
          dismissedById: "user-1",
        }),
        dismissedBy: {
          id: "user-1",
          name: "Test User",
          email: "test@example.com",
        },
      };
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test-workspace", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      janitorMockSetup.mockRecommendationExists(mockedDb, mockRecommendation);
      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
      vi.mocked(db.janitorRecommendation.update).mockResolvedValue(dismissedRecommendation as any);

      const result = await dismissJanitorRecommendation("rec-1", "user-1", {
        reason: "Not applicable",
      });

      expect(db.janitorRecommendation.update).toHaveBeenCalledWith({
        where: { id: "rec-1" },
        data: {
          status: "DISMISSED",
          dismissedAt: expect.any(Date),
          dismissedById: "user-1",
          metadata: {
            dismissalReason: "Not applicable",
          },
        },
        include: {
          dismissedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });
      expect(result.status).toBe("DISMISSED");
    });

    test("should throw error when recommendation not found", async () => {
      janitorMockSetup.mockRecommendationNotFound(mockedDb);

      await expect(dismissJanitorRecommendation("rec-1", "user-1")).rejects.toThrow(
        JANITOR_ERRORS.RECOMMENDATION_NOT_FOUND
      );
    });

    test("should throw error when recommendation already processed", async () => {
      const mockRecommendation = {
        ...janitorMocks.createMockRecommendation({ status: "DISMISSED" }),
        janitorRun: {
          id: "run-1",
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          janitorConfig: {
            id: "config-1",
            workspace: {
              id: "ws-1",
              slug: "test-workspace",
            },
          },
        },
      };

      janitorMockSetup.mockRecommendationExists(mockedDb, mockRecommendation);

      await expect(dismissJanitorRecommendation("rec-1", "user-1")).rejects.toThrow(
        JANITOR_ERRORS.RECOMMENDATION_ALREADY_PROCESSED
      );
    });

    test("should throw error when user lacks write permission", async () => {
      const mockRecommendation = {
        ...janitorMocks.createMockRecommendation({ status: "PENDING" }),
        janitorRun: {
          id: "run-1",
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          janitorConfig: {
            id: "config-1",
            workspace: {
              id: "ws-1",
              slug: "test-workspace",
            },
          },
        },
      };
      const mockValidation = {
        hasAccess: true,
        canRead: true,
        canWrite: false,
        canAdmin: false,
        workspace: { id: "ws-1", name: "Test", slug: "test-workspace", ownerId: "owner-1", description: null, createdAt: TEST_DATE_ISO, updatedAt: TEST_DATE_ISO },
      };

      janitorMockSetup.mockRecommendationExists(mockedDb, mockRecommendation);
      mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);

      await expect(dismissJanitorRecommendation("rec-1", "user-1")).rejects.toThrow(
        JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS
      );
    });
  });

  describe("processJanitorWebhook", () => {
    test("should process completed webhook and create recommendations", async () => {
      const mockRun = {
        ...janitorMocks.createMockRunWithConfig({ status: "COMPLETED" }),
        _count: { recommendations: 0 },
      };
      const webhookPayload = {
        projectId: 12345,
        status: "completed",
        results: {
          recommendations: [
            {
              title: "Add unit tests for auth",
              description: "Authentication module lacks test coverage",
              priority: "HIGH",
              impact: "Critical for security",
            },
            {
              title: "Add integration tests",
              description: "API endpoints need integration tests",
              priority: "MEDIUM",
              impact: "Improves reliability",
            },
          ],
        },
      };

      vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(db.janitorRun.findFirst).mockResolvedValue(mockRun as any);
      vi.mocked(db.janitorRecommendation.count).mockResolvedValue(2);
      janitorMockSetup.mockTransactionSuccess(
        mockedDb,
        vi.fn().mockResolvedValue({}),
        vi.fn().mockResolvedValue({ count: 2 })
      );
      mockedPusherServer.trigger = vi.fn().mockResolvedValue({});

      const result = await processJanitorWebhook(webhookPayload);

      expect(db.janitorRun.updateMany).toHaveBeenCalledWith({
        where: {
          stakworkProjectId: 12345,
          status: { in: ["PENDING", "RUNNING"] },
        },
        data: {
          status: "COMPLETED",
          completedAt: expect.any(Date),
        },
      });
      expect(db.$transaction).toHaveBeenCalled();
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        expect.stringContaining("workspace-"),
        "recommendations-updated",
        expect.objectContaining({
          workspaceSlug: "test-workspace",
          newRecommendationCount: 2,
          totalRecommendationCount: 2,
        })
      );
      expect(result.status).toBe("COMPLETED");
      expect(result.recommendationCount).toBe(2);
    });

    test("should process failed webhook", async () => {
      const mockRun = {
        ...janitorMocks.createMockRunWithConfig({ status: "FAILED" }),
        _count: { recommendations: 0 },
      };
      const webhookPayload = {
        projectId: 12345,
        status: "failed",
        error: "Stakwork processing error",
      };

      vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(db.janitorRun.findFirst).mockResolvedValue(mockRun as any);
      vi.mocked(db.janitorRun.update).mockResolvedValue(mockRun as any);

      const result = await processJanitorWebhook(webhookPayload);

      expect(db.janitorRun.updateMany).toHaveBeenCalledWith({
        where: {
          stakworkProjectId: 12345,
          status: { in: ["PENDING", "RUNNING"] },
        },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: "Stakwork processing error",
        },
      });
      expect(result.status).toBe("FAILED");
      expect(result.error).toBe("Stakwork processing error");
    });

    test("should process running webhook", async () => {
      const mockRun = {
        ...janitorMocks.createMockRunWithConfig({ status: "RUNNING" }),
        _count: { recommendations: 0 },
      };
      const webhookPayload = {
        projectId: 12345,
        status: "running",
      };

      vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(db.janitorRun.findFirst).mockResolvedValue(mockRun as any);
      vi.mocked(db.janitorRun.update).mockResolvedValue(mockRun as any);

      const result = await processJanitorWebhook(webhookPayload);

      expect(db.janitorRun.updateMany).toHaveBeenCalledWith({
        where: {
          stakworkProjectId: 12345,
          status: { in: ["PENDING", "RUNNING"] },
        },
        data: {
          status: "RUNNING",
          startedAt: expect.any(Date),
        },
      });
      expect(result.status).toBe("RUNNING");
    });

    test("should throw error when janitor run not found", async () => {
      const webhookPayload = {
        projectId: 12345,
        status: "completed",
      };

      vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 0 });

      await expect(processJanitorWebhook(webhookPayload)).rejects.toThrow(
        JANITOR_ERRORS.RUN_NOT_FOUND
      );
    });

    test("should handle webhook with no recommendations", async () => {
      const mockRun = {
        ...janitorMocks.createMockRunWithConfig({ status: "COMPLETED" }),
        _count: { recommendations: 0 },
      };
      const webhookPayload = {
        projectId: 12345,
        status: "completed",
        results: {
          recommendations: [],
        },
      };

      vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(db.janitorRun.findFirst).mockResolvedValue(mockRun as any);
      vi.mocked(db.janitorRecommendation.count).mockResolvedValue(0);
      janitorMockSetup.mockTransactionSuccess(
        mockedDb,
        vi.fn().mockResolvedValue({}),
        vi.fn().mockResolvedValue({ count: 0 })
      );

      const result = await processJanitorWebhook(webhookPayload);

      expect(result.status).toBe("COMPLETED");
      expect(result.recommendationCount).toBe(0);
      expect(pusherServer.trigger).not.toHaveBeenCalled();
    });

    test("should handle Pusher trigger failure gracefully", async () => {
      const mockRun = {
        ...janitorMocks.createMockRunWithConfig({ status: "COMPLETED" }),
        _count: { recommendations: 0 },
      };
      const webhookPayload = {
        projectId: 12345,
        status: "completed",
        results: {
          recommendations: [
            {
              title: "Test recommendation",
              description: "Test description",
              priority: "MEDIUM",
            },
          ],
        },
      };

      vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(db.janitorRun.findFirst).mockResolvedValue(mockRun as any);
      vi.mocked(db.janitorRecommendation.count).mockResolvedValue(1);
      janitorMockSetup.mockTransactionSuccess(
        mockedDb,
        vi.fn().mockResolvedValue({}),
        vi.fn().mockResolvedValue({ count: 1 })
      );
      mockedPusherServer.trigger = vi.fn().mockRejectedValue(new Error("Pusher error"));

      // Should not throw error even if Pusher fails
      const result = await processJanitorWebhook(webhookPayload);

      expect(result.status).toBe("COMPLETED");
      expect(result.recommendationCount).toBe(1);
    });
  });
});