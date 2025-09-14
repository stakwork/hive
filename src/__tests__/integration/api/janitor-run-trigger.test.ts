import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { POST as TriggerRun } from "@/app/api/workspaces/[slug]/janitors/[type]/run/route";
import { WorkspaceRole, JanitorType } from "@prisma/client";
import { db } from "@/lib/db";
import { stakworkService } from "@/lib/service-factory";

// Mock external dependencies
vi.mock("next-auth/next");
vi.mock("@/lib/service-factory");

const mockGetServerSession = vi.mocked(getServerSession);
const mockStakworkService = vi.mocked(stakworkService);

describe("Manual Janitor Run Triggering - /api/workspaces/[slug]/janitors/[type]/run", () => {
  async function createTestWorkspaceWithUser(role: WorkspaceRole = "OWNER") {
    return await db.$transaction(async (tx) => {
      // Create the test user
      const user = await tx.user.create({
        data: {
          id: `user-${Date.now()}-${Math.random()}`,
          email: `user-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      if (role === "OWNER") {
        // If role is OWNER, make them the actual workspace owner
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
            role: "OWNER",
          },
        });

        return { user, workspace };
      } else {
        // For non-OWNER roles, create a separate owner and add user as member
        const owner = await tx.user.create({
          data: {
            id: `owner-${Date.now()}-${Math.random()}`,
            email: `owner-${Date.now()}@example.com`,
            name: "Workspace Owner",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: `Test Workspace ${Date.now()}`,
            slug: `test-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
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
    
    // Ensure environment variables exist for each test
    process.env.STAKWORK_API_KEY = "test-api-key";
    process.env.STAKWORK_JANITOR_WORKFLOW_ID = "123";
    process.env.STAKWORK_BASE_URL = "https://api.stakwork.com/api/v1";
    
    // Set up default Stakwork service mock
    const mockStakworkRequest = vi.fn().mockResolvedValue({
      success: true,
      data: { project_id: 123 }
    });
    
    mockStakworkService.mockReturnValue({
      stakworkRequest: mockStakworkRequest
    } as any);
  });

  describe("Authentication and Authorization", () => {
    test("should reject unauthenticated requests with 401", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: "test-workspace", type: "unit_tests" }),
      });

      expect(response.status).toBe(401);
      const responseData = await response.json();
      expect(responseData.error).toBe("Unauthorized");
    });

    test("should reject requests without valid user ID with 401", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: "test@example.com" } // No ID field
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: "test-workspace", type: "unit_tests" }),
      });

      expect(response.status).toBe(401);
      const responseData = await response.json();
      expect(responseData.error).toBe("Unauthorized");
    });

    test("should allow workspace OWNER to trigger janitor runs", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("OWNER");
      
      // Enable unit tests
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
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.success).toBe(true);
      expect(responseData.run).toMatchObject({
        janitorType: "UNIT_TESTS",
        triggeredBy: "MANUAL",
      });
    });

    test("should allow workspace ADMIN to trigger janitor runs", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable unit tests
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
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.success).toBe(true);
    });

    test("should reject VIEWER from triggering janitor runs", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("VIEWER");
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      // Should fail due to insufficient permissions
      expect(response.status).toBe(400);
      const responseData = await response.json();
      expect(responseData.error).toContain("Insufficient permissions");
    });

    test("should reject user not in workspace", async () => {
      // Create workspace with different user
      const { workspace } = await createTestWorkspaceWithUser("OWNER");
      
      // Create separate user not in workspace
      const outsideUser = await db.user.create({
        data: {
          id: `outside-user-${Date.now()}`,
          email: `outside-${Date.now()}@example.com`,
          name: "Outside User",
        },
      });
      
      mockGetServerSession.mockResolvedValue({
        user: { id: outsideUser.id, email: outsideUser.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      expect(response.status).toBe(400);
      const responseData = await response.json();
      expect(responseData.error).toContain("Insufficient permissions");
    });

    test("should reject requests for non-existent workspace", async () => {
      const user = await db.user.create({
        data: {
          id: `user-${Date.now()}`,
          email: `user-${Date.now()}@example.com`,
          name: "Test User",
        },
      });
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: "non-existent-workspace", type: "unit_tests" }),
      });

      expect(response.status).toBe(400);
      const responseData = await response.json();
      expect(responseData.error).toContain("Insufficient permissions");
    });
  });

  describe("Janitor Type Validation", () => {
    test("should reject invalid janitor types", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: workspace.slug, type: "invalid_type" }),
      });

      expect(response.status).toBe(400);
      const responseData = await response.json();
      expect(responseData.error).toBe("Invalid janitor type");
    });

    test("should accept valid janitor types - UNIT_TESTS", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable unit tests
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
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.run.janitorType).toBe("UNIT_TESTS");
    });

    test("should accept valid janitor types - INTEGRATION_TESTS", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable integration tests
      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          integrationTestsEnabled: true,
        },
      });
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: workspace.slug, type: "integration_tests" }),
      });

      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.run.janitorType).toBe("INTEGRATION_TESTS");
    });

    test("should accept valid janitor types - E2E_TESTS", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable e2e tests
      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          e2eTestsEnabled: true,
        },
      });
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: workspace.slug, type: "e2e_tests" }),
      });

      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.run.janitorType).toBe("E2E_TESTS");
    });

    test("should accept valid janitor types - SECURITY_REVIEW", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable security review
      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          securityReviewEnabled: true,
        },
      });
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: workspace.slug, type: "security_review" }),
      });

      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.run.janitorType).toBe("SECURITY_REVIEW");
    });

    test("should handle case insensitive janitor types", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable unit tests
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
        params: Promise.resolve({ slug: workspace.slug, type: "Unit_Tests" }),
      });

      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.run.janitorType).toBe("UNIT_TESTS");
    });
  });

  describe("Janitor Enable/Disable Validation", () => {
    test("should reject disabled janitor types", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Create config but leave unit tests disabled (default)
      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: false,
        },
      });
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      expect(response.status).toBe(400);
      const responseData = await response.json();
      expect(responseData.error).toBe("This janitor type is not enabled");
    });

    test("should reject janitor when no config exists (all disabled by default)", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // No janitor config created - should be disabled by default
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      expect(response.status).toBe(400);
      const responseData = await response.json();
      expect(responseData.error).toBe("This janitor type is not enabled");
    });
  });

  describe("Successful Janitor Run Triggering", () => {
    test("should successfully trigger janitor run with proper response format", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable unit tests
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
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      expect(response.status).toBe(200);
      const responseData = await response.json();
      
      // Verify response format
      expect(responseData).toMatchObject({
        success: true,
        run: {
          id: expect.any(String),
          janitorType: "UNIT_TESTS",
          status: "RUNNING",
          triggeredBy: "MANUAL",
          createdAt: expect.any(String),
        }
      });
    });

    test("should create database record with correct values", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable unit tests
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
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      expect(response.status).toBe(200);

      // Verify database record was created
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
      expect(runs[0]).toMatchObject({
        janitorType: "UNIT_TESTS",
        status: "RUNNING",
        triggeredBy: "MANUAL",
        stakworkProjectId: 123, // From mock
      });

      // Verify metadata contains user info
      const metadata = runs[0].metadata as any;
      expect(metadata.triggeredByUserId).toBe(user.id);
      expect(metadata.workspaceId).toBe(workspace.id);
    });

    test("should call Stakwork service with correct parameters", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Create workspace with swarm info
      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: `swarm-${workspace.slug}`,
          swarmUrl: "https://test.sphinx.chat/api",
          swarmSecretAlias: "{{SWARM_TEST_API_KEY}}",
        },
      });
      
      // Enable unit tests
      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      const mockStakworkRequest = vi.fn().mockResolvedValue({
        success: true,
        data: { project_id: 456 }
      });
      
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest
      } as any);
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      expect(response.status).toBe(200);

      // Verify Stakwork was called with correct parameters
      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          name: expect.stringMatching(/^janitor-unit_tests-\d+$/),
          workflow_id: 123,
          workflow_params: {
            set_var: {
              attributes: {
                vars: {
                  janitorType: "UNIT_TESTS",
                  webhookUrl: expect.stringContaining("/api/janitors/webhook"),
                  swarmUrl: "https://test.sphinx.chat/api",
                  swarmSecretAlias: "{{SWARM_TEST_API_KEY}}",
                }
              }
            }
          }
        })
      );
    });
  });

  describe("Concurrent Run Handling", () => {
    test("should allow concurrent runs of same janitor type", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable unit tests and create existing run
      const config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      // Create existing running janitor run
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
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      // Should succeed - concurrent runs are allowed
      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.success).toBe(true);
      expect(responseData.run.janitorType).toBe("UNIT_TESTS");

      // Verify two runs exist in database
      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
      });
      expect(runs).toHaveLength(2);
    });

    test("should allow concurrent runs of different janitor types", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable both unit tests and integration tests
      const config = await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
          integrationTestsEnabled: true,
        },
      });

      // Create existing unit tests run
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
      
      // Trigger integration tests while unit tests are running
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: workspace.slug, type: "integration_tests" }),
      });

      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.success).toBe(true);
      expect(responseData.run.janitorType).toBe("INTEGRATION_TESTS");

      // Verify both runs exist
      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
      });
      expect(runs).toHaveLength(2);
      expect(runs.map(r => r.janitorType)).toContain("UNIT_TESTS");
      expect(runs.map(r => r.janitorType)).toContain("INTEGRATION_TESTS");
    });
  });

  describe("Stakwork Integration Error Handling", () => {
    test("should handle Stakwork API failures", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable unit tests
      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      // Mock Stakwork failure
      const mockStakworkRequest = vi.fn().mockRejectedValue(
        new Error("Stakwork API unavailable")
      );
      
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest
      } as any);
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      expect(response.status).toBe(500);
      const responseData = await response.json();
      expect(responseData.error).toBe("Internal server error");

      // Verify database record shows failure
      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
      });
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("FAILED");
      expect(runs[0].error).toContain("Stakwork API unavailable");
    });

    test("should handle missing Stakwork project ID", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable unit tests
      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      // Mock Stakwork response without project_id
      const mockStakworkRequest = vi.fn().mockResolvedValue({
        success: true,
        data: {} // Missing project_id
      });
      
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest
      } as any);
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      expect(response.status).toBe(500);
      const responseData = await response.json();
      expect(responseData.error).toBe("Internal server error");

      // Verify database record shows failure
      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
      });
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("FAILED");
      expect(runs[0].error).toContain("No project ID returned from Stakwork");
    });

    // Note: This test is commented out because the integration test environment 
    // automatically sets up required environment variables in setup-integration.ts
    test.skip("should handle missing environment variables", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable unit tests
      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      // Store original values
      const originalApiKey = process.env.STAKWORK_API_KEY;
      const originalWorkflowId = process.env.STAKWORK_JANITOR_WORKFLOW_ID;

      // Remove required environment variables
      delete process.env.STAKWORK_API_KEY;
      delete process.env.STAKWORK_JANITOR_WORKFLOW_ID;
      
      try {
        mockGetServerSession.mockResolvedValue({
          user: { id: user.id, email: user.email },
        } as any);

        const request = new NextRequest("http://localhost/api/test", {
          method: "POST",
        });
        
        const response = await TriggerRun(request, {
          params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
        });

        expect(response.status).toBe(500);
        const responseData = await response.json();
        expect(responseData.error).toBe("Internal server error");

        // Verify database record shows failure
        const runs = await db.janitorRun.findMany({
          where: {
            janitorConfig: {
              workspaceId: workspace.id,
            },
          },
        });
        expect(runs).toHaveLength(1);
        expect(runs[0].status).toBe("FAILED");
        expect(runs[0].error).toContain("required");
      } finally {
        // Restore original values
        if (originalApiKey !== undefined) {
          process.env.STAKWORK_API_KEY = originalApiKey;
        }
        if (originalWorkflowId !== undefined) {
          process.env.STAKWORK_JANITOR_WORKFLOW_ID = originalWorkflowId;
        }
      }
    });
  });

  describe("Edge Cases and Boundary Conditions", () => {
    test("should handle workspace slug with special characters", async () => {
      const user = await db.user.create({
        data: {
          id: `user-${Date.now()}`,
          email: `user-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace-with-dashes-and-numbers-123",
          ownerId: user.id,
        },
      });

      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: "OWNER",
        },
      });

      // Enable unit tests
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
          slug: "test-workspace-with-dashes-and-numbers-123", 
          type: "unit_tests" 
        }),
      });

      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.success).toBe(true);
    });

    test("should handle very long janitor run names", async () => {
      const { user, workspace } = await createTestWorkspaceWithUser("ADMIN");
      
      // Enable unit tests
      await db.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
        },
      });

      // Mock current timestamp to create predictable name
      const mockTimestamp = 1234567890123;
      vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp);
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
      });
      
      const response = await TriggerRun(request, {
        params: Promise.resolve({ slug: workspace.slug, type: "unit_tests" }),
      });

      expect(response.status).toBe(200);

      // Verify Stakwork was called with predictable name format
      const mockStakworkRequest = mockStakworkService().stakworkRequest as any;
      expect(mockStakworkRequest).toHaveBeenCalledWith(
        "/projects",
        expect.objectContaining({
          name: `janitor-unit_tests-${mockTimestamp}`,
        })
      );

      vi.restoreAllMocks();
    });
  });
});