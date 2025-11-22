import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/cron/janitors/route";
import { db } from "@/lib/db";
import { JanitorType } from "@prisma/client";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import { expectSuccess } from "@/__tests__/support/helpers";
import { NextRequest } from "next/server";

// Mock the Stakwork service
vi.mock("@/services/stakwork", () => ({
  stakworkService: vi.fn(() => ({
    stakworkRequest: vi.fn(),
  })),
}));

// Mock the GitHub credentials helper
vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

describe("Janitor Cron API - Integration Tests", () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset environment variables to defaults
    process.env.JANITOR_CRON_ENABLED = "true";
    process.env.STAKWORK_API_KEY = "test-stakwork-key";
    process.env.STAKWORK_JANITOR_WORKFLOW_ID = "12345";
    process.env.STAKWORK_BASE_URL = "https://api.stakwork.com/api/v1";

    // Mock successful Stakwork response by default
    const { stakworkService } = await import("@/services/stakwork");
    const mockStakworkService = stakworkService as unknown as ReturnType<
      typeof vi.fn
    >;
    mockStakworkService.mockReturnValue({
      stakworkRequest: vi.fn().mockResolvedValue({
        data: { project_id: 123 },
      }),
    });

    // Mock GitHub credentials by default
    const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
    const mockGetGithubCreds = getGithubUsernameAndPAT as unknown as ReturnType<
      typeof vi.fn
    >;
    mockGetGithubCreds.mockResolvedValue({
      username: "test-github-user",
      token: "ghp_test_token",
    });
  });

  afterEach(() => {
    // Restore original env vars
    process.env = { ...originalEnv };
  });

  describe("GET /api/cron/janitors", () => {
    test("returns early when feature flag is disabled", async () => {
      // Setup
      process.env.JANITOR_CRON_ENABLED = "false";

      // Execute
      const response = await GET();

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(0);
      expect(data.runsCreated).toBe(0);
      expect(data.errors).toEqual([]);
      // Note: disabled response doesn't include timestamp (unlike enabled response)
    });

    test("processes workspaces with enabled janitors", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Create janitor config with enabled janitors
      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
          integrationTestsEnabled: false,
          e2eTestsEnabled: false,
          securityReviewEnabled: false,
        },
      });

      // Create repository for the workspace
      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
          status: "SYNCED",
        },
      });

      // Create swarm for the workspace
      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          status: "ACTIVE",
          swarmUrl: "https://swarm.example.com",
          swarmSecretAlias: "test-secret",
        },
      });

      // Execute
      const response = await GET();

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(1);
      expect(data.runsCreated).toBe(1); // Only UNIT_TESTS enabled
      expect(data.errorCount).toBe(0);
      expect(data.errors).toEqual([]);
      expect(data.timestamp).toBeDefined();

      // Verify janitor run was created in database
      const janitorRuns = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
      });

      expect(janitorRuns).toHaveLength(1);
      expect(janitorRuns[0].janitorType).toBe(JanitorType.UNIT_TESTS);
      expect(janitorRuns[0].status).toBe("RUNNING");
      expect(janitorRuns[0].triggeredBy).toBe("SCHEDULED");
      expect(janitorRuns[0].stakworkProjectId).toBe(123);
    });

    test("processes multiple workspaces with different janitor configurations", async () => {
      // Setup
      const user1 = await createTestUser();
      const workspace1 = await createTestWorkspace({
        ownerId: user1.id,
        slug: "workspace-1",
      });

      await db.janitorConfig.create({
        data: {
          workspaceId: workspace1.id,
          unitTestsEnabled: true,
          integrationTestsEnabled: true,
        },
      });

      await db.repository.create({
        data: {
          name: "repo-1",
          repositoryUrl: "https://github.com/test/repo1",
          branch: "main",
          workspaceId: workspace1.id,
          status: "SYNCED",
        },
      });

      await db.swarm.create({
        data: {
          workspaceId: workspace1.id,
          name: "swarm-1",
          status: "ACTIVE",
          swarmUrl: "https://swarm1.example.com",
          swarmSecretAlias: "secret-1",
        },
      });

      const user2 = await createTestUser();
      const workspace2 = await createTestWorkspace({
        ownerId: user2.id,
        slug: "workspace-2",
      });

      await db.janitorConfig.create({
        data: {
          workspaceId: workspace2.id,
          securityReviewEnabled: true,
        },
      });

      await db.repository.create({
        data: {
          name: "repo-2",
          repositoryUrl: "https://github.com/test/repo2",
          branch: "main",
          workspaceId: workspace2.id,
          status: "SYNCED",
        },
      });

      await db.swarm.create({
        data: {
          workspaceId: workspace2.id,
          name: "swarm-2",
          status: "ACTIVE",
          swarmUrl: "https://swarm2.example.com",
          swarmSecretAlias: "secret-2",
        },
      });

      // Execute
      const response = await GET();

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(2);
      expect(data.runsCreated).toBe(3); // 2 from workspace1 + 1 from workspace2
      expect(data.errorCount).toBe(0);

      // Verify all runs were created
      const allRuns = await db.janitorRun.findMany({
        include: {
          janitorConfig: {
            include: {
              workspace: true,
            },
          },
        },
      });

      expect(allRuns).toHaveLength(3);
      expect(allRuns.every((run) => run.status === "RUNNING")).toBe(true);
      expect(allRuns.every((run) => run.triggeredBy === "SCHEDULED")).toBe(
        true
      );
    });

    test("collects errors without halting execution", async () => {
      // Setup
      const user1 = await createTestUser();
      const workspace1 = await createTestWorkspace({
        ownerId: user1.id,
        slug: "workspace-success",
      });

      await db.janitorConfig.create({
        data: {
          workspaceId: workspace1.id,
          unitTestsEnabled: true,
        },
      });

      await db.repository.create({
        data: {
          name: "repo-success",
          repositoryUrl: "https://github.com/test/success",
          branch: "main",
          workspaceId: workspace1.id,
          status: "SYNCED",
        },
      });

      await db.swarm.create({
        data: {
          workspaceId: workspace1.id,
          name: "swarm-success",
          status: "ACTIVE",
          swarmUrl: "https://swarm.example.com",
          swarmSecretAlias: "secret",
        },
      });

      // Create second workspace that will fail
      const user2 = await createTestUser();
      const workspace2 = await createTestWorkspace({
        ownerId: user2.id,
        slug: "workspace-failure",
      });

      await db.janitorConfig.create({
        data: {
          workspaceId: workspace2.id,
          integrationTestsEnabled: true,
        },
      });

      await db.repository.create({
        data: {
          name: "repo-failure",
          repositoryUrl: "https://github.com/test/failure",
          branch: "main",
          workspaceId: workspace2.id,
          status: "SYNCED",
        },
      });

      await db.swarm.create({
        data: {
          workspaceId: workspace2.id,
          name: "swarm-failure",
          status: "ACTIVE",
          swarmUrl: "https://swarm2.example.com",
          swarmSecretAlias: "secret-2",
        },
      });

      // Mock Stakwork to succeed for first workspace, fail for second
      const { stakworkService } = await import("@/services/stakwork");
      const mockStakworkService = stakworkService as unknown as ReturnType<
        typeof vi.fn
      >;

      let callCount = 0;
      mockStakworkService.mockReturnValue({
        stakworkRequest: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // First call succeeds
            return Promise.resolve({ data: { project_id: 123 } });
          } else {
            // Second call fails
            return Promise.reject(new Error("Stakwork API error"));
          }
        }),
      });

      // Execute
      const response = await GET();

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(false); // Success is false due to error
      expect(data.workspacesProcessed).toBe(2);
      expect(data.runsCreated).toBe(1); // Only first workspace succeeded
      expect(data.errorCount).toBe(1);
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0]).toMatchObject({
        workspaceSlug: "workspace-failure",
        janitorType: JanitorType.INTEGRATION_TESTS,
        error: expect.stringContaining("Stakwork API error"),
      });

      // Verify first workspace has successful run
      const successfulRuns = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspace: {
              slug: "workspace-success",
            },
          },
        },
      });
      expect(successfulRuns).toHaveLength(1);
      expect(successfulRuns[0].status).toBe("RUNNING");

      // Verify second workspace has failed run
      const failedRuns = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspace: {
              slug: "workspace-failure",
            },
          },
        },
      });
      expect(failedRuns).toHaveLength(1);
      expect(failedRuns[0].status).toBe("FAILED");
    });

    test("skips workspaces with no enabled janitors", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "disabled-workspace",
      });

      // Create janitor config with all janitors disabled
      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: false,
          integrationTestsEnabled: false,
          securityReviewEnabled: false,
        },
      });

      // Execute
      const response = await GET();

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(0); // Workspace not processed
      expect(data.runsCreated).toBe(0);
      expect(data.errors).toEqual([]);

      // Verify no runs were created
      const runs = await db.janitorRun.count();
      expect(runs).toBe(0);
    });

    test("returns valid response structure", async () => {
      // Setup - no workspaces

      // Execute
      const response = await GET();

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("workspacesProcessed");
      expect(data).toHaveProperty("runsCreated");
      expect(data).toHaveProperty("errorCount");
      expect(data).toHaveProperty("errors");
      expect(data).toHaveProperty("timestamp");

      expect(typeof data.success).toBe("boolean");
      expect(typeof data.workspacesProcessed).toBe("number");
      expect(typeof data.runsCreated).toBe("number");
      expect(typeof data.errorCount).toBe("number");
      expect(Array.isArray(data.errors)).toBe(true);
      expect(typeof data.timestamp).toBe("string");

      // Verify timestamp is valid ISO string
      expect(() => new Date(data.timestamp)).not.toThrow();
      const parsedDate = new Date(data.timestamp);
      expect(parsedDate.toISOString()).toBe(data.timestamp);
    });

    test("invokes Stakwork API with correct parameters", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "test-workspace",
      });

      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
          status: "SYNCED",
          ignoreDirs: JSON.stringify(["node_modules", "dist"]),
        },
      });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          status: "ACTIVE",
          swarmUrl: "https://swarm.example.com",
          swarmSecretAlias: "test-secret",
        },
      });

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        data: { project_id: 456 },
      });

      const { stakworkService } = await import("@/services/stakwork");
      const mockStakworkService = stakworkService as unknown as ReturnType<
        typeof vi.fn
      >;
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      });

      // Execute
      const response = await GET();

      // Assert
      await expectSuccess(response, 200);

      // Verify Stakwork API was called with correct parameters
      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          name: expect.stringMatching(/^janitor-unit_tests-\d+$/),
          workflow_id: 12345,
          workflow_params: {
            set_var: {
              attributes: {
                vars: expect.objectContaining({
                  janitorType: JanitorType.UNIT_TESTS,
                  webhookUrl: expect.stringContaining("/api/janitors/webhook"),
                  swarmUrl: "https://swarm.example.com",
                  swarmSecretAlias: "test-secret",
                  workspaceId: workspace.id,
                  repositoryUrl: "https://github.com/test/repo",
                  ignoreDirs: JSON.stringify(["node_modules", "dist"]),
                  username: "test-github-user",
                  pat: "ghp_test_token",
                }),
              },
            },
          },
        })
      );
    });

    test("handles missing Stakwork API key gracefully", async () => {
      // Setup
      delete process.env.STAKWORK_API_KEY;

      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
      });

      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      await db.repository.create({
        data: {
          name: "repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
          status: "SYNCED",
        },
      });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "swarm",
          status: "ACTIVE",
        },
      });

      // Execute
      const response = await GET();

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(false);
      expect(data.errorCount).toBeGreaterThan(0);
      expect(data.errors[0].error).toContain("STAKWORK_API_KEY");
    });

    test("handles missing workflow ID gracefully", async () => {
      // Setup
      delete process.env.STAKWORK_JANITOR_WORKFLOW_ID;

      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
      });

      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          securityReviewEnabled: true,
        },
      });

      await db.repository.create({
        data: {
          name: "repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
          status: "SYNCED",
        },
      });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "swarm",
          status: "ACTIVE",
        },
      });

      // Execute
      const response = await GET();

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(false);
      expect(data.errorCount).toBeGreaterThan(0);
      expect(data.errors[0].error).toContain("STAKWORK_JANITOR_WORKFLOW_ID");
    });

    test("handles internal errors gracefully", async () => {
      // Setup - Mock database error during workspace query
      const originalFindMany = db.workspace.findMany;
      vi.spyOn(db.workspace, "findMany").mockRejectedValue(
        new Error("Database connection error")
      );

      // Execute
      const response = await GET();

      // Assert
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Internal server error");
      expect(data.timestamp).toBeDefined();

      // Restore
      db.workspace.findMany = originalFindMany;
    });

    test("includes GitHub credentials in Stakwork payload when available", async () => {
      // Setup
      const user = await createTestUser({ withGitHubAuth: true });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
      });

      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          integrationTestsEnabled: true,
        },
      });

      await db.repository.create({
        data: {
          name: "repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
          status: "SYNCED",
        },
      });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "swarm",
          status: "ACTIVE",
        },
      });

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        data: { project_id: 789 },
      });

      const { stakworkService } = await import("@/services/stakwork");
      const mockStakworkService = stakworkService as unknown as ReturnType<
        typeof vi.fn
      >;
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      });

      // Execute
      const response = await GET();

      // Assert
      await expectSuccess(response, 200);

      // Verify GitHub credentials were included
      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          workflow_params: {
            set_var: {
              attributes: {
                vars: expect.objectContaining({
                  username: "test-github-user",
                  pat: "ghp_test_token",
                }),
              },
            },
          },
        })
      );
    });
  });
});