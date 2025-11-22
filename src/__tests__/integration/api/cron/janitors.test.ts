import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { JanitorType } from "@prisma/client";
import { GET } from "@/app/api/cron/janitors/route";
import { NextRequest } from "next/server";
import { resetDatabase } from "@/__tests__/support/fixtures/database";
import { stakworkService } from "@/lib/service-factory";

/**
 * Integration tests for Janitor Cron Endpoint
 * 
 * Verifies:
 * 1. Feature flag behavior (enabled/disabled)
 * 2. Multi-workspace orchestration
 * 3. Janitor run creation and Stakwork workflow trigger
 * 4. Error handling and isolation per workspace
 * 5. Response structure and data integrity
 * 
 * Note: Uses real PostgreSQL test database, mocks external services (Stakwork, GitHub)
 */

// Mock Stakwork service
vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({
    stakworkRequest: vi.fn(),
  })),
}));

// Mock environment config for Stakwork
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_JANITOR_WORKFLOW_ID: "123",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  },
}));

// Mock GitHub credentials retrieval
vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue({
    username: "test-github-user",
    token: "ghp_test_token_123",
  }),
}));

const mockStakworkService = stakworkService as vi.MockedFunction<typeof stakworkService>;

// Track Stakwork calls
let stakworkCallCount = 0;
let stakworkCalls: any[] = [];

beforeEach(() => {
  stakworkCallCount = 0;
  stakworkCalls = [];
  
  // Setup Stakwork mock to track calls
  mockStakworkService.mockReturnValue({
    stakworkRequest: vi.fn().mockImplementation((endpoint: string, payload: any) => {
      stakworkCallCount++;
      stakworkCalls.push({ endpoint, payload });
      
      return Promise.resolve({
        success: true,
        data: {
          project_id: 1000 + stakworkCallCount, // Unique project ID per call
        },
      });
    }),
  } as any);
});

describe("Integration: GET /api/cron/janitors", () => {
  let testUser: any;

  beforeEach(async () => {
    // Reset database before each test
    await resetDatabase();

    // Create test user
    testUser = await db.user.create({
      data: {
        email: "janitor-test@example.com",
        name: "Janitor Test User",
      },
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    stakworkCallCount = 0;
    stakworkCalls = [];
  });

  describe("Feature Flag Control", () => {
    test("should return success with zero counts when JANITOR_CRON_ENABLED is false", async () => {
      // Set feature flag to disabled
      process.env.JANITOR_CRON_ENABLED = "false";

      // Create workspace with enabled janitors (should be ignored)
      await db.workspace.create({
        data: {
          slug: "test-workspace-disabled",
          name: "Test Workspace Disabled",
          ownerId: testUser.id,
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
              integrationTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/janitors");
      const response = await GET();
      const result = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.message).toBe("Janitor cron is disabled");
      expect(result.workspacesProcessed).toBe(0);
      expect(result.runsCreated).toBe(0);
      expect(result.errors).toEqual([]);

      // Verify no janitor runs were created
      const runCount = await db.janitorRun.count();
      expect(runCount).toBe(0);

      // Verify Stakwork was not called
      expect(stakworkCallCount).toBe(0);
    });

    test("should process workspaces when JANITOR_CRON_ENABLED is true", async () => {
      // Set feature flag to enabled
      process.env.JANITOR_CRON_ENABLED = "true";

      // Create workspace with enabled janitors
      const workspace = await db.workspace.create({
        data: {
          slug: "test-workspace-enabled",
          name: "Test Workspace Enabled",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm",
              swarmUrl: "https://test-swarm.com",
              poolName: "test-pool",
              swarmSecretAlias: "{{TEST_SECRET}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/janitors");
      const response = await GET();
      const result = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(1);
      expect(result.runsCreated).toBe(1);
      expect(result.errors).toEqual([]);

      // Verify janitor run was created
      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
      });

      expect(runs).toHaveLength(1);
      expect(runs[0].janitorType).toBe(JanitorType.UNIT_TESTS);
      expect(runs[0].triggeredBy).toBe("SCHEDULED");
      expect(runs[0].status).toBe("RUNNING");
      expect(runs[0].stakworkProjectId).toBe(1001);

      // Verify Stakwork was called once
      expect(stakworkCallCount).toBe(1);
      expect(stakworkCalls[0].payload.workflow_params.set_var.attributes.vars.janitorType).toBe("UNIT_TESTS");
    });
  });

  describe("Workspace Discovery and Orchestration", () => {
    test("should return zero counts when no workspaces have enabled janitors", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      // Create workspace with all janitors disabled
      await db.workspace.create({
        data: {
          slug: "test-workspace-no-janitors",
          name: "Test Workspace No Janitors",
          ownerId: testUser.id,
          janitorConfig: {
            create: {
              unitTestsEnabled: false,
              integrationTestsEnabled: false,
              e2eTestsEnabled: false,
              securityReviewEnabled: false,
            },
          },
        },
      });

      // Execute endpoint
      const response = await GET();
      const result = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(0);
      expect(result.runsCreated).toBe(0);
      expect(result.errors).toEqual([]);

      // Verify no janitor runs were created
      const runCount = await db.janitorRun.count();
      expect(runCount).toBe(0);
    });

    test("should create multiple runs for workspace with multiple enabled janitor types", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      // Create workspace with multiple enabled janitors
      const workspace = await db.workspace.create({
        data: {
          slug: "test-workspace-multi-janitors",
          name: "Test Workspace Multi Janitors",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm",
              swarmUrl: "https://test-swarm.com",
              poolName: "test-pool",
              swarmSecretAlias: "{{TEST_SECRET}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
              integrationTestsEnabled: true,
              e2eTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      const response = await GET();
      const result = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(1);
      expect(result.runsCreated).toBe(3); // 3 janitor types enabled

      // Verify janitor runs were created
      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
        orderBy: {
          janitorType: "asc",
        },
      });

      expect(runs).toHaveLength(3);
      expect(runs.map(r => r.janitorType).sort()).toEqual([
        JanitorType.E2E_TESTS,
        JanitorType.INTEGRATION_TESTS,
        JanitorType.UNIT_TESTS,
      ]);
      expect(runs.every(r => r.triggeredBy === "SCHEDULED")).toBe(true);
      expect(runs.every(r => r.status === "RUNNING")).toBe(true);

      // Verify Stakwork was called 3 times
      expect(stakworkCallCount).toBe(3);
    });

    test("should process multiple workspaces and create runs for each", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      // Create first workspace
      const workspace1 = await db.workspace.create({
        data: {
          slug: "workspace-1",
          name: "Workspace 1",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "swarm-1",
              swarmUrl: "https://test-swarm-1.com",
              poolName: "pool-1",
              swarmSecretAlias: "{{SECRET_1}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo1",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
            },
          },
        },
      });

      // Create second workspace
      const workspace2 = await db.workspace.create({
        data: {
          slug: "workspace-2",
          name: "Workspace 2",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "swarm-2",
              swarmUrl: "https://test-swarm-2.com",
              poolName: "pool-2",
              swarmSecretAlias: "{{SECRET_2}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo2",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              integrationTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      const response = await GET();
      const result = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(2);
      expect(result.runsCreated).toBe(2);
      expect(result.errors).toEqual([]);

      // Verify runs were created for both workspaces
      const runs1 = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace1.id,
          },
        },
      });
      const runs2 = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace2.id,
          },
        },
      });

      expect(runs1).toHaveLength(1);
      expect(runs1[0].janitorType).toBe(JanitorType.UNIT_TESTS);

      expect(runs2).toHaveLength(1);
      expect(runs2[0].janitorType).toBe(JanitorType.INTEGRATION_TESTS);

      // Verify Stakwork was called twice
      expect(stakworkCallCount).toBe(2);
    });

    test("should skip deleted workspaces", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      // Create deleted workspace
      await db.workspace.create({
        data: {
          slug: "deleted-workspace",
          name: "Deleted Workspace",
          ownerId: testUser.id,
          deleted: true,
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      const response = await GET();
      const result = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(0);
      expect(result.runsCreated).toBe(0);

      // Verify no runs were created
      const runCount = await db.janitorRun.count();
      expect(runCount).toBe(0);
    });
  });

  describe("Error Handling and Isolation", () => {
    test("should capture Stakwork error for one workspace and continue processing others", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      // Mock Stakwork to fail for first call, succeed for second
      let callCount = 0;
      mockStakworkService.mockReturnValue({
        stakworkRequest: vi.fn().mockImplementation((endpoint: string, payload: any) => {
          callCount++;
          stakworkCallCount++;
          stakworkCalls.push({ endpoint, payload });
          
          if (callCount === 1) {
            // First call fails
            return Promise.reject(new Error("Stakwork API error"));
          }
          // Second call succeeds
          return Promise.resolve({
            success: true,
            data: {
              project_id: 1000 + stakworkCallCount,
            },
          });
        }),
      } as any);

      // Create first workspace (will fail due to Stakwork error)
      const workspace1 = await db.workspace.create({
        data: {
          slug: "workspace-fail",
          name: "Workspace Fail",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm-1",
              swarmUrl: "https://test-swarm-1.com",
              poolName: "test-pool-1",
              swarmSecretAlias: "{{TEST_SECRET_1}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo1",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
            },
          },
        },
      });

      // Create second workspace (will succeed)
      const workspace2 = await db.workspace.create({
        data: {
          slug: "workspace-success",
          name: "Workspace Success",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm-2",
              swarmUrl: "https://test-swarm-2.com",
              poolName: "test-pool-2",
              swarmSecretAlias: "{{TEST_SECRET_2}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo2",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      const response = await GET();
      const result = await response.json();

      // Verify response shows partial failure
      expect(response.status).toBe(200);
      expect(result.success).toBe(false); // At least one error occurred
      expect(result.workspacesProcessed).toBe(2);
      expect(result.runsCreated).toBe(1); // Only workspace2 succeeded
      expect(result.errorCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].workspaceSlug).toBe("workspace-fail");
      expect(result.errors[0].janitorType).toBe(JanitorType.UNIT_TESTS);
      expect(result.errors[0].error).toBeTruthy();

      // Verify successful workspace created run
      const runs2 = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace2.id,
          },
        },
      });

      expect(runs2).toHaveLength(1);
      expect(runs2[0].status).toBe("RUNNING");

      // Verify failed workspace created failed run
      const runs1 = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace1.id,
          },
        },
      });

      expect(runs1).toHaveLength(1);
      expect(runs1[0].status).toBe("FAILED");
    });

    test("should handle multiple errors across workspaces", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      // Mock Stakwork to always fail
      mockStakworkService.mockReturnValue({
        stakworkRequest: vi.fn().mockRejectedValue(new Error("Stakwork API error")),
      } as any);

      // Create two workspaces (both will fail)
      await db.workspace.create({
        data: {
          slug: "workspace-fail-1",
          name: "Workspace Fail 1",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm-1",
              swarmUrl: "https://test-swarm-1.com",
              poolName: "test-pool-1",
              swarmSecretAlias: "{{TEST_SECRET_1}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo1",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
            },
          },
        },
      });

      await db.workspace.create({
        data: {
          slug: "workspace-fail-2",
          name: "Workspace Fail 2",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm-2",
              swarmUrl: "https://test-swarm-2.com",
              poolName: "test-pool-2",
              swarmSecretAlias: "{{TEST_SECRET_2}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo2",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              integrationTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      const response = await GET();
      const result = await response.json();

      // Verify response shows multiple errors
      expect(response.status).toBe(200);
      expect(result.success).toBe(false);
      expect(result.workspacesProcessed).toBe(2);
      expect(result.runsCreated).toBe(0);
      expect(result.errorCount).toBe(2);
      expect(result.errors).toHaveLength(2);

      // Verify both workspace errors are captured
      const errorSlugs = result.errors.map((e: any) => e.workspaceSlug).sort();
      expect(errorSlugs).toEqual(["workspace-fail-1", "workspace-fail-2"]);
    });
  });

  describe("Response Structure Validation", () => {
    test("should return all required fields in success response", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      // Create workspace with enabled janitor
      await db.workspace.create({
        data: {
          slug: "test-workspace",
          name: "Test Workspace",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm",
              swarmUrl: "https://test-swarm.com",
              poolName: "test-pool",
              swarmSecretAlias: "{{TEST_SECRET}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      const response = await GET();
      const result = await response.json();

      // Verify all required fields are present
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("workspacesProcessed");
      expect(result).toHaveProperty("runsCreated");
      expect(result).toHaveProperty("errorCount");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("timestamp");

      // Verify field types
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.workspacesProcessed).toBe("number");
      expect(typeof result.runsCreated).toBe("number");
      expect(typeof result.errorCount).toBe("number");
      expect(Array.isArray(result.errors)).toBe(true);
      expect(typeof result.timestamp).toBe("string");

      // Verify timestamp is ISO format
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test("should return correct error structure in error response", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      // Mock Stakwork to fail
      mockStakworkService.mockReturnValue({
        stakworkRequest: vi.fn().mockRejectedValue(new Error("Stakwork API error")),
      } as any);

      // Create workspace with swarm (will fail due to Stakwork error)
      await db.workspace.create({
        data: {
          slug: "workspace-error",
          name: "Workspace Error",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm",
              swarmUrl: "https://test-swarm.com",
              poolName: "test-pool",
              swarmSecretAlias: "{{TEST_SECRET}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      const response = await GET();
      const result = await response.json();

      // Verify error structure
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toHaveProperty("workspaceSlug");
      expect(result.errors[0]).toHaveProperty("janitorType");
      expect(result.errors[0]).toHaveProperty("error");

      expect(typeof result.errors[0].workspaceSlug).toBe("string");
      expect(typeof result.errors[0].janitorType).toBe("string");
      expect(typeof result.errors[0].error).toBe("string");
    });
  });

  describe("Database State Validation", () => {
    test("should create JanitorRun records with correct initial status", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const workspace = await db.workspace.create({
        data: {
          slug: "test-workspace-db",
          name: "Test Workspace DB",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm",
              swarmUrl: "https://test-swarm.com",
              poolName: "test-pool",
              swarmSecretAlias: "{{TEST_SECRET}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      await GET();

      // Verify JanitorRun was created
      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      expect(runs).toHaveLength(1);

      const run = runs[0];
      expect(run.janitorType).toBe(JanitorType.UNIT_TESTS);
      expect(run.triggeredBy).toBe("SCHEDULED");
      expect(run.status).toBe("RUNNING"); // After Stakwork success
      expect(run.stakworkProjectId).toBeTruthy();
      expect(run.startedAt).toBeTruthy();
      expect(run.completedAt).toBeNull();
      expect(run.error).toBeNull();

      // Verify metadata
      const metadata = run.metadata as any;
      expect(metadata.triggeredByUserId).toBe(testUser.id);
      expect(metadata.workspaceId).toBe(workspace.id);
    });

    test("should store Stakwork project ID in JanitorRun", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const workspace = await db.workspace.create({
        data: {
          slug: "test-workspace-stakwork",
          name: "Test Workspace Stakwork",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm",
              swarmUrl: "https://test-swarm.com",
              poolName: "test-pool",
              swarmSecretAlias: "{{TEST_SECRET}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      await GET();

      // Verify stakworkProjectId was stored
      const run = await db.janitorRun.findFirst({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
      });

      expect(run).not.toBeNull();
      expect(run!.stakworkProjectId).toBe(1001); // From mock
    });
  });

  describe("Stakwork API Integration", () => {
    test("should trigger Stakwork workflow with correct parameters", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const workspace = await db.workspace.create({
        data: {
          slug: "test-workspace-params",
          name: "Test Workspace Params",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm",
              swarmUrl: "https://test-swarm.com",
              poolName: "test-pool",
              swarmSecretAlias: "{{TEST_SECRET}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo",
              branch: "main",
              ignoreDirs: "node_modules,dist",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      await GET();

      // Verify Stakwork was called with correct parameters
      expect(stakworkCallCount).toBe(1);
      expect(stakworkCalls[0].payload).toBeTruthy();

      const payload = stakworkCalls[0].payload;
      expect(payload.workflow_id).toBeTruthy();
      expect(payload.workflow_params.set_var.attributes.vars).toMatchObject({
        janitorType: "UNIT_TESTS",
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
        ignoreDirs: "node_modules,dist",
        swarmUrl: "https://test-swarm.com",
        swarmSecretAlias: "{{TEST_SECRET}}",
        username: "test-github-user",
        pat: "ghp_test_token_123",
      });
      expect(payload.workflow_params.set_var.attributes.vars.webhookUrl).toContain("/api/janitors/webhook");
    });

    test("should trigger multiple Stakwork workflows for multiple janitor types", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      await db.workspace.create({
        data: {
          slug: "test-workspace-multi",
          name: "Test Workspace Multi",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm",
              swarmUrl: "https://test-swarm.com",
              poolName: "test-pool",
              swarmSecretAlias: "{{TEST_SECRET}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
              integrationTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      await GET();

      // Verify Stakwork was called twice
      expect(stakworkCallCount).toBe(2);

      // Verify different janitor types were passed
      const janitorTypes = stakworkCalls.map(
        (call) => call.payload.workflow_params.set_var.attributes.vars.janitorType
      );
      expect(janitorTypes).toContain("UNIT_TESTS");
      expect(janitorTypes).toContain("INTEGRATION_TESTS");
    });
  });

  describe("Edge Cases", () => {
    test("should handle workspace without repository gracefully", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const workspace = await db.workspace.create({
        data: {
          slug: "workspace-no-repo",
          name: "Workspace No Repo",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm",
              swarmUrl: "https://test-swarm.com",
              poolName: "test-pool",
              swarmSecretAlias: "{{TEST_SECRET}}",
            },
          },
          // No repository created
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      const response = await GET();
      const result = await response.json();

      // Should still succeed (repository is optional for janitor workflows)
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.runsCreated).toBe(1);

      // Verify run was created with null repositoryUrl
      const run = await db.janitorRun.findFirst({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
      });

      expect(run).not.toBeNull();
      expect(run!.status).toBe("RUNNING");

      // Verify Stakwork call had null repositoryUrl
      expect(stakworkCalls[0].payload.workflow_params.set_var.attributes.vars.repositoryUrl).toBeNull();
    });

    test("should handle workspace without GitHub credentials gracefully", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      // Mock getGithubUsernameAndPAT to return null
      const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValueOnce(null);

      const workspace = await db.workspace.create({
        data: {
          slug: "workspace-no-github",
          name: "Workspace No GitHub",
          ownerId: testUser.id,
          swarm: {
            create: {
              name: "test-swarm",
              swarmUrl: "https://test-swarm.com",
              poolName: "test-pool",
              swarmSecretAlias: "{{TEST_SECRET}}",
            },
          },
          repositories: {
            create: [{
              name: "Test Repository",
              repositoryUrl: "https://github.com/test/repo",
              branch: "main",
              status: "SYNCED",
            }],
          },
          janitorConfig: {
            create: {
              unitTestsEnabled: true,
            },
          },
        },
      });

      // Execute endpoint
      const response = await GET();
      const result = await response.json();

      // Should still succeed (GitHub credentials are optional)
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.runsCreated).toBe(1);

      // Verify Stakwork call had null GitHub credentials
      expect(stakworkCalls[0].payload.workflow_params.set_var.attributes.vars.username).toBeNull();
      expect(stakworkCalls[0].payload.workflow_params.set_var.attributes.vars.pat).toBeNull();
    });
  });
});