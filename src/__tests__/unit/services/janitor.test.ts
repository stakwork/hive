import { describe, test, expect, beforeEach, vi } from "vitest";
import { createJanitorRun } from "@/services/janitor";
import { validateWorkspaceAccess } from "@/services/workspace";
import { db } from "@/lib/db";
import { stakworkService } from "@/lib/service-factory";
import { JANITOR_ERRORS } from "@/lib/constants/janitor";
import { JanitorType, JanitorTrigger } from "@prisma/client";

// Mock all external dependencies
vi.mock("@/services/workspace");
vi.mock("@/lib/db", () => ({
  db: {
    janitorConfig: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    janitorRun: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("@/lib/service-factory");
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-key",
    STAKWORK_JANITOR_WORKFLOW_ID: 123,
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  },
}));

// Type the mocked functions
const mockValidateWorkspaceAccess = vi.mocked(validateWorkspaceAccess);
const mockStakworkService = vi.mocked(stakworkService);

/**
 * Test Data Factories
 * Centralized test data creation following DRY principles
 */
const TestDataFactories = {
  workspaceValidation: (overrides = {}) => ({
    hasAccess: true,
    canRead: true,
    canWrite: true,
    canAdmin: true,
    userRole: "DEVELOPER",
    workspace: {
      id: "workspace-123",
      name: "Test Workspace",
      slug: "test-workspace",
      ownerId: "owner-123",
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
      ...overrides,
    },
  }),

  janitorConfig: (overrides = {}) => ({
    id: "config-123",
    workspaceId: "workspace-123",
    unitTestsEnabled: true,
    integrationTestsEnabled: false,
    e2eTestsEnabled: false,
    securityReviewEnabled: false,
    taskCoordinatorEnabled: false,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  }),

  janitorRun: (overrides = {}) => ({
    id: "run-123",
    janitorConfigId: "config-123",
    janitorType: "UNIT_TESTS" as JanitorType,
    status: "PENDING" as const,
    triggeredBy: "MANUAL" as JanitorTrigger,
    stakworkProjectId: null,
    startedAt: null,
    completedAt: null,
    error: null,
    metadata: {
      triggeredByUserId: "user-123",
      workspaceId: "workspace-123",
    },
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    janitorConfig: {
      id: "config-123",
      workspace: {
        id: "workspace-123",
        swarm: {
          swarmUrl: "https://swarm.test/api",
          swarmSecretAlias: "test-secret",
          poolName: "test-pool",
          name: "test-swarm",
          id: "swarm-123",
        },
      },
    },
    ...overrides,
  }),

  stakworkResponse: (overrides = {}) => ({
    success: true,
    data: {
      project_id: 12345,
      name: "janitor-unit_tests-1234567890",
      status: "created",
      ...overrides,
    },
  }),
};

/**
 * Mock Setup Utilities
 * Reusable mock configuration functions
 */
const MockSetup = {
  /**
   * Setup successful validation with write permissions
   */
  setupSuccessfulValidation: (overrides = {}) => {
    mockValidateWorkspaceAccess.mockResolvedValue(
      TestDataFactories.workspaceValidation(overrides) as any
    );
  },

  /**
   * Setup validation failure (no access)
   */
  setupNoAccessValidation: () => {
    mockValidateWorkspaceAccess.mockResolvedValue({
      hasAccess: false,
      canRead: false,
      canWrite: false,
      canAdmin: false,
    } as any);
  },

  /**
   * Setup validation with read-only permissions
   */
  setupReadOnlyValidation: () => {
    mockValidateWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canRead: true,
      canWrite: false,
      canAdmin: false,
      userRole: "VIEWER",
      workspace: TestDataFactories.workspaceValidation().workspace,
    } as any);
  },

  /**
   * Setup database to return existing janitor config
   */
  setupExistingJanitorConfig: (config = {}) => {
    const janitorConfig = TestDataFactories.janitorConfig(config);
    (db.janitorConfig.findUnique as any).mockResolvedValue(janitorConfig);
    return janitorConfig;
  },

  /**
   * Setup database to create new janitor config
   */
  setupNewJanitorConfig: (config = {}) => {
    const janitorConfig = TestDataFactories.janitorConfig(config);
    (db.janitorConfig.findUnique as any).mockResolvedValue(null);
    (db.janitorConfig.create as any).mockResolvedValue(janitorConfig);
    return janitorConfig;
  },

  /**
   * Setup database to create janitor run
   */
  setupJanitorRunCreation: (run = {}) => {
    const janitorRun = TestDataFactories.janitorRun(run);
    (db.janitorRun.create as any).mockResolvedValue(janitorRun);
    return janitorRun;
  },

  /**
   * Setup database to update janitor run
   */
  setupJanitorRunUpdate: (run = {}) => {
    const updatedRun = TestDataFactories.janitorRun({
      status: "RUNNING",
      stakworkProjectId: 12345,
      startedAt: new Date("2025-01-01T00:00:00Z"),
      ...run,
    });
    (db.janitorRun.update as any).mockResolvedValue(updatedRun);
    return updatedRun;
  },

  /**
   * Setup successful Stakwork API response
   */
  setupSuccessfulStakworkRequest: (response = {}) => {
    const stakworkResponse = TestDataFactories.stakworkResponse(response);
    const mockStakworkRequest = vi.fn().mockResolvedValue(stakworkResponse);
    mockStakworkService.mockReturnValue({
      stakworkRequest: mockStakworkRequest,
    } as any);
    return mockStakworkRequest;
  },

  /**
   * Setup failed Stakwork API response
   */
  setupFailedStakworkRequest: (error = "Stakwork API error") => {
    const mockStakworkRequest = vi.fn().mockRejectedValue(new Error(error));
    mockStakworkService.mockReturnValue({
      stakworkRequest: mockStakworkRequest,
    } as any);
    return mockStakworkRequest;
  },
};

/**
 * Assertion Utilities
 * Reusable verification functions
 */
const AssertionUtils = {
  /**
   * Assert validateWorkspaceAccess was called correctly
   */
  expectValidateWorkspaceAccessCalled: (
    workspaceSlug: string,
    userId: string
  ) => {
    expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith(
      workspaceSlug,
      userId
    );
    expect(mockValidateWorkspaceAccess).toHaveBeenCalledTimes(1);
  },

  /**
   * Assert janitor config was retrieved
   */
  expectJanitorConfigRetrieved: (workspaceId: string) => {
    expect(db.janitorConfig.findUnique).toHaveBeenCalledWith({
      where: { workspaceId },
    });
  },

  /**
   * Assert janitor run was created with correct data
   */
  expectJanitorRunCreated: (
    configId: string,
    janitorType: JanitorType,
    triggeredBy: JanitorTrigger,
    userId: string,
    workspaceId: string
  ) => {
    expect(db.janitorRun.create).toHaveBeenCalledWith({
      data: {
        janitorConfigId: configId,
        janitorType,
        triggeredBy,
        status: "PENDING",
        metadata: {
          triggeredByUserId: userId,
          workspaceId,
        },
      },
      include: {
        janitorConfig: {
          include: {
            workspace: {
              include: {
                swarm: {
                  select: {
                    swarmUrl: true,
                    swarmSecretAlias: true,
                    poolName: true,
                    name: true,
                    id: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  },

  /**
   * Assert Stakwork API was called with correct payload
   */
  expectStakworkRequestCalled: (
    mockRequest: any,
    janitorType: string,
    webhookUrl: string
  ) => {
    expect(mockRequest).toHaveBeenCalledWith("/projects", {
      name: expect.stringContaining(`janitor-${janitorType.toLowerCase()}`),
      workflow_id: 123,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              janitorType: janitorType.toUpperCase(),
              webhookUrl,
              swarmUrl: "https://swarm.test/api",
              swarmSecretAlias: "test-secret",
            },
          },
        },
      },
    });
  },

  /**
   * Assert janitor run was updated to RUNNING status
   */
  expectJanitorRunUpdatedToRunning: (runId: string, projectId: number) => {
    expect(db.janitorRun.update).toHaveBeenCalledWith({
      where: { id: runId },
      data: {
        stakworkProjectId: projectId,
        status: "RUNNING",
        startedAt: expect.any(Date),
      },
      include: expect.any(Object),
    });
  },

  /**
   * Assert janitor run was updated to FAILED status
   */
  expectJanitorRunUpdatedToFailed: (runId: string, errorMessage: string) => {
    expect(db.janitorRun.update).toHaveBeenCalledWith({
      where: { id: runId },
      data: {
        status: "FAILED",
        completedAt: expect.any(Date),
        error: expect.stringContaining(errorMessage),
      },
    });
  },
};

describe("createJanitorRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication and Authorization", () => {
    test("should throw INSUFFICIENT_PERMISSIONS when user has no access", async () => {
      MockSetup.setupNoAccessValidation();

      await expect(
        createJanitorRun("test-workspace", "user-123", "unit_tests", "MANUAL")
      ).rejects.toThrow(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);

      AssertionUtils.expectValidateWorkspaceAccessCalled(
        "test-workspace",
        "user-123"
      );
    });

    test("should throw INSUFFICIENT_PERMISSIONS when user lacks write permission", async () => {
      MockSetup.setupReadOnlyValidation();

      await expect(
        createJanitorRun("test-workspace", "user-123", "unit_tests", "MANUAL")
      ).rejects.toThrow(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);

      AssertionUtils.expectValidateWorkspaceAccessCalled(
        "test-workspace",
        "user-123"
      );
    });

    test("should proceed when user has write permission", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupNewJanitorConfig();
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      AssertionUtils.expectValidateWorkspaceAccessCalled(
        "test-workspace",
        "user-123"
      );
      expect(db.janitorRun.create).toHaveBeenCalled();
    });
  });

  describe("Janitor Type Validation", () => {
    test("should throw error for invalid janitor type", async () => {
      MockSetup.setupSuccessfulValidation();

      await expect(
        createJanitorRun(
          "test-workspace",
          "user-123",
          "invalid_type",
          "MANUAL"
        )
      ).rejects.toThrow("Invalid janitor type: invalid_type");
    });

    test("should accept valid janitor type: UNIT_TESTS", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      const result = await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      expect(result.janitorType).toBe("UNIT_TESTS");
    });

    test("should accept valid janitor type: INTEGRATION_TESTS", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ integrationTestsEnabled: true });
      MockSetup.setupJanitorRunCreation({
        janitorType: "INTEGRATION_TESTS" as JanitorType,
      });
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate({
        janitorType: "INTEGRATION_TESTS" as JanitorType,
      });

      const result = await createJanitorRun(
        "test-workspace",
        "user-123",
        "integration_tests",
        "MANUAL"
      );

      expect(result.janitorType).toBe("INTEGRATION_TESTS");
    });

    test("should accept valid janitor type: E2E_TESTS", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ e2eTestsEnabled: true });
      MockSetup.setupJanitorRunCreation({
        janitorType: "E2E_TESTS" as JanitorType,
      });
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate({ janitorType: "E2E_TESTS" as JanitorType });

      const result = await createJanitorRun(
        "test-workspace",
        "user-123",
        "e2e_tests",
        "MANUAL"
      );

      expect(result.janitorType).toBe("E2E_TESTS");
    });

    test("should accept valid janitor type: SECURITY_REVIEW", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ securityReviewEnabled: true });
      MockSetup.setupJanitorRunCreation({
        janitorType: "SECURITY_REVIEW" as JanitorType,
      });
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate({
        janitorType: "SECURITY_REVIEW" as JanitorType,
      });

      const result = await createJanitorRun(
        "test-workspace",
        "user-123",
        "security_review",
        "MANUAL"
      );

      expect(result.janitorType).toBe("SECURITY_REVIEW");
    });

    test("should handle case-insensitive janitor type", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      const result = await createJanitorRun(
        "test-workspace",
        "user-123",
        "UnIt_TeSts",
        "MANUAL"
      );

      expect(result.janitorType).toBe("UNIT_TESTS");
    });
  });

  describe("Janitor Configuration", () => {
    test("should create janitor config if it doesn't exist", async () => {
      MockSetup.setupSuccessfulValidation();
      const config = MockSetup.setupNewJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      AssertionUtils.expectJanitorConfigRetrieved("workspace-123");
      expect(db.janitorConfig.create).toHaveBeenCalledWith({
        data: { workspaceId: "workspace-123" },
      });
    });

    test("should use existing janitor config if it exists", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      AssertionUtils.expectJanitorConfigRetrieved("workspace-123");
      expect(db.janitorConfig.create).not.toHaveBeenCalled();
    });

    test("should throw JANITOR_DISABLED when janitor type is disabled", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: false });

      await expect(
        createJanitorRun("test-workspace", "user-123", "unit_tests", "MANUAL")
      ).rejects.toThrow(JANITOR_ERRORS.JANITOR_DISABLED);

      expect(db.janitorRun.create).not.toHaveBeenCalled();
    });

    test("should allow run when corresponding janitor type is enabled", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({
        unitTestsEnabled: true,
        integrationTestsEnabled: false,
      });
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      const result = await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      expect(result).toBeDefined();
      expect(result.janitorType).toBe("UNIT_TESTS");
    });
  });

  describe("Janitor Run Creation", () => {
    test("should create janitor run with PENDING status", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      const run = MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      AssertionUtils.expectJanitorRunCreated(
        "config-123",
        "UNIT_TESTS" as JanitorType,
        "MANUAL",
        "user-123",
        "workspace-123"
      );
    });

    test("should include triggeredByUserId and workspaceId in metadata", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      expect(db.janitorRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: {
              triggeredByUserId: "user-123",
              workspaceId: "workspace-123",
            },
          }),
        })
      );
    });

    test("should support SCHEDULED trigger type", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation({ triggeredBy: "SCHEDULED" as JanitorTrigger });
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate({ triggeredBy: "SCHEDULED" as JanitorTrigger });

      const result = await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "SCHEDULED"
      );

      expect(result.triggeredBy).toBe("SCHEDULED");
    });
  });

  describe("Stakwork Integration", () => {
    test("should call Stakwork API with correct payload", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      const mockRequest = MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      AssertionUtils.expectStakworkRequestCalled(
        mockRequest,
        "unit_tests",
        "https://api.stakwork.com/api/janitors/webhook"
      );
    });

    test("should include swarm configuration in Stakwork payload", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      const mockRequest = MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      expect(mockRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          workflow_params: {
            set_var: {
              attributes: {
                vars: expect.objectContaining({
                  swarmUrl: "https://swarm.test/api",
                  swarmSecretAlias: "test-secret",
                }),
              },
            },
          },
        })
      );
    });

    test("should update janitor run to RUNNING status on successful Stakwork call", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      const run = MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest({ data: { project_id: 12345 } });
      MockSetup.setupJanitorRunUpdate();

      const result = await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      AssertionUtils.expectJanitorRunUpdatedToRunning("run-123", 12345);
      expect(result.status).toBe("RUNNING");
      expect(result.stakworkProjectId).toBe(12345);
    });

    test("should handle missing project_id in Stakwork response", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      const mockRequest = vi.fn().mockResolvedValue({
        success: true,
        data: {}, // Missing project_id
      });
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockRequest,
      } as any);
      (db.janitorRun.update as any).mockResolvedValueOnce(
        TestDataFactories.janitorRun({ status: "FAILED" })
      );

      await expect(
        createJanitorRun("test-workspace", "user-123", "unit_tests", "MANUAL")
      ).rejects.toThrow("Failed to start janitor run");

      AssertionUtils.expectJanitorRunUpdatedToFailed(
        "run-123",
        "No project ID returned from Stakwork"
      );
    });
  });

  describe("Stakwork API Failure Handling", () => {
    test("should update janitor run to FAILED status when Stakwork API fails", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      const run = MockSetup.setupJanitorRunCreation();
      MockSetup.setupFailedStakworkRequest("API connection timeout");
      (db.janitorRun.update as any).mockResolvedValueOnce(
        TestDataFactories.janitorRun({ status: "FAILED" })
      );

      await expect(
        createJanitorRun("test-workspace", "user-123", "unit_tests", "MANUAL")
      ).rejects.toThrow("Failed to start janitor run");

      AssertionUtils.expectJanitorRunUpdatedToFailed(
        "run-123",
        "Failed to initialize Stakwork project: API connection timeout"
      );
    });

    test("should include Stakwork error message in database error field", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupFailedStakworkRequest("Invalid workflow ID");
      (db.janitorRun.update as any).mockResolvedValueOnce(
        TestDataFactories.janitorRun({ status: "FAILED" })
      );

      await expect(
        createJanitorRun("test-workspace", "user-123", "unit_tests", "MANUAL")
      ).rejects.toThrow();

      expect(db.janitorRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            error: expect.stringContaining("Invalid workflow ID"),
          }),
        })
      );
    });

    test("should set completedAt timestamp on Stakwork failure", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupFailedStakworkRequest("Service unavailable");
      (db.janitorRun.update as any).mockResolvedValueOnce(
        TestDataFactories.janitorRun({ status: "FAILED" })
      );

      await expect(
        createJanitorRun("test-workspace", "user-123", "unit_tests", "MANUAL")
      ).rejects.toThrow();

      expect(db.janitorRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FAILED",
            completedAt: expect.any(Date),
          }),
        })
      );
    });
  });

  // Environment Variable Validation tests disabled - these require runtime mocking
  // The vi.mock() calls inside individual tests don't override the already imported module
  // Would need to be tested at integration level or with dynamic import approach

  describe("Success Path - Complete Workflow", () => {
    test("should successfully create and start janitor run with all steps", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      const mockRequest = MockSetup.setupSuccessfulStakworkRequest();
      const updatedRun = MockSetup.setupJanitorRunUpdate();

      const result = await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      // Verify complete workflow
      AssertionUtils.expectValidateWorkspaceAccessCalled(
        "test-workspace",
        "user-123"
      );
      AssertionUtils.expectJanitorConfigRetrieved("workspace-123");
      AssertionUtils.expectJanitorRunCreated(
        "config-123",
        "UNIT_TESTS" as JanitorType,
        "MANUAL",
        "user-123",
        "workspace-123"
      );
      expect(mockRequest).toHaveBeenCalled();
      AssertionUtils.expectJanitorRunUpdatedToRunning("run-123", 12345);

      // Verify final result
      expect(result).toEqual(updatedRun);
      expect(result.status).toBe("RUNNING");
      expect(result.stakworkProjectId).toBe(12345);
      expect(result.startedAt).toBeDefined();
    });

    test("should return janitor run with full workspace and swarm context", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      const result = await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      expect(result.janitorConfig).toBeDefined();
      expect(result.janitorConfig.workspace).toBeDefined();
      expect(result.janitorConfig.workspace.swarm).toBeDefined();
      expect(result.janitorConfig.workspace.swarm.swarmUrl).toBe(
        "https://swarm.test/api"
      );
    });
  });

  describe("Edge Cases", () => {
    test("should handle workspace with no swarm configuration", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation({
        janitorConfig: {
          workspace: {
            swarm: null, // No swarm configured
          },
        },
      });
      const mockRequest = MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      // Should use empty strings for swarm fields
      expect(mockRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          workflow_params: {
            set_var: {
              attributes: {
                vars: expect.objectContaining({
                  swarmUrl: "",
                  swarmSecretAlias: "",
                }),
              },
            },
          },
        })
      );
    });

    test("should handle very long workspace slug", async () => {
      const longSlug = "a".repeat(100);
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      await createJanitorRun(longSlug, "user-123", "unit_tests", "MANUAL");

      AssertionUtils.expectValidateWorkspaceAccessCalled(longSlug, "user-123");
    });

    test("should handle database transaction failure during run creation", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      (db.janitorRun.create as any).mockRejectedValue(
        new Error("Database connection error")
      );

      await expect(
        createJanitorRun("test-workspace", "user-123", "unit_tests", "MANUAL")
      ).rejects.toThrow("Database connection error");
    });

    test("should handle database transaction failure during status update", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest();
      (db.janitorRun.update as any).mockRejectedValue(
        new Error("Update failed")
      );

      await expect(
        createJanitorRun("test-workspace", "user-123", "unit_tests", "MANUAL")
      ).rejects.toThrow("Update failed");
    });
  });

  describe("Type Safety", () => {
    test("should enforce valid JanitorTrigger enum values", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      // Valid trigger types
      const validTriggers: JanitorTrigger[] = [
        "MANUAL",
        "SCHEDULED",
        "WEBHOOK",
        "ON_COMMIT",
      ];

      for (const trigger of validTriggers) {
        vi.clearAllMocks();
        MockSetup.setupSuccessfulValidation();
        MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
        MockSetup.setupJanitorRunCreation({ triggeredBy: trigger });
        MockSetup.setupSuccessfulStakworkRequest();
        MockSetup.setupJanitorRunUpdate({ triggeredBy: trigger });

        const result = await createJanitorRun(
          "test-workspace",
          "user-123",
          "unit_tests",
          trigger
        );

        expect(result.triggeredBy).toBe(trigger);
      }
    });

    test("should return proper janitor run type with all fields", async () => {
      MockSetup.setupSuccessfulValidation();
      MockSetup.setupExistingJanitorConfig({ unitTestsEnabled: true });
      MockSetup.setupJanitorRunCreation();
      MockSetup.setupSuccessfulStakworkRequest();
      MockSetup.setupJanitorRunUpdate();

      const result = await createJanitorRun(
        "test-workspace",
        "user-123",
        "unit_tests",
        "MANUAL"
      );

      // Verify all required fields are present
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("janitorConfigId");
      expect(result).toHaveProperty("janitorType");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("triggeredBy");
      expect(result).toHaveProperty("stakworkProjectId");
      expect(result).toHaveProperty("startedAt");
      expect(result).toHaveProperty("createdAt");
      expect(result).toHaveProperty("updatedAt");
      expect(result).toHaveProperty("janitorConfig");
    });
  });
});