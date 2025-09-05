import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/code-graph/wizard-state/route";
import { db } from "@/lib/db";
import { validateUserWorkspaceAccess } from "@/lib/auth/workspace-resolver";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock workspace validation
vi.mock("@/lib/auth/workspace-resolver", () => ({
  validateUserWorkspaceAccess: vi.fn(),
}));

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;
const mockValidateUserWorkspaceAccess = validateUserWorkspaceAccess as vi.MockedFunction<typeof validateUserWorkspaceAccess>;

describe("Code Graph Wizard State API Integration Tests", () => {
  async function createTestUserWithWorkspace() {
    // Use a transaction to ensure atomicity
    return await db.$transaction(async (tx) => {
      // Create test user
      const testUser = await tx.user.create({
        data: {
          id: `test-user-${Date.now()}-${Math.random()}`,
          email: `test-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      // Create test workspace
      const testWorkspace = await tx.workspace.create({
        data: {
          id: `test-workspace-${Date.now()}-${Math.random()}`,
          name: "Test Workspace",
          slug: `test-workspace-${Date.now()}`,
          description: "Test workspace for integration testing",
          ownerId: testUser.id,
          stakworkApiKey: "test_stakwork_key_123",
          deleted: false,
        },
      });

      // Create test swarm with sensitive configuration
      const testSwarm = await tx.swarm.create({
        data: {
          id: `test-swarm-${Date.now()}-${Math.random()}`,
          swarmId: "test-swarm-123",
          name: "Test Swarm",
          status: "ACTIVE",
          instanceType: "XL",
          repositoryName: "test-repo",
          repositoryUrl: "https://github.com/testuser/test-repo",
          defaultBranch: "main",
          swarmApiKey: "sensitive_swarm_api_key_123",
          poolApiKey: "sensitive_pool_api_key_456",
          environmentVariables: [
            { name: "API_SECRET", value: "super_secret_value" },
            { name: "DATABASE_URL", value: "postgresql://sensitive_connection" },
          ],
          services: [
            {
              name: "web",
              port: 3000,
              env: { NODE_ENV: "production" },
              scripts: { start: "npm start" },
            },
          ],
          wizardStep: "COMPLETION",
          stepStatus: "COMPLETED",
          wizardData: {
            sensitiveConfig: {
              apiKeys: ["key1", "key2"],
              secrets: { dbPassword: "super_secret_db_pass" },
            },
            seeded: true,
            seededAt: new Date().toISOString(),
          },
          workspaceId: testWorkspace.id,
          ingestRefId: "ingest-123",
          poolName: "test-pool",
        },
      });

      return { testUser, testWorkspace, testSwarm };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/code-graph/wizard-state", () => {
    test("should expose sensitive wizard state data successfully with proper authentication", async () => {
      const { testUser, testWorkspace, testSwarm } = await createTestUserWithWorkspace();
      
      // Mock session with real user
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: "Test User" },
      });

      // Mock workspace validation success
      mockValidateUserWorkspaceAccess.mockResolvedValue(testWorkspace.slug);

      const request = new NextRequest(
        `http://localhost:3000/api/code-graph/wizard-state?workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();

      // Verify sensitive data exposure
      expect(data.data.swarmId).toBe(testSwarm.swarmId);
      expect(data.data.swarmName).toBe(testSwarm.name);
      expect(data.data.workspaceId).toBe(testWorkspace.id);
      expect(data.data.workspaceSlug).toBe(testWorkspace.slug);
      expect(data.data.workspaceName).toBe(testWorkspace.name);
      expect(data.data.repositoryUrl).toBe(testSwarm.repositoryUrl);
      expect(data.data.poolName).toBe(testSwarm.poolName);
      expect(data.data.ingestRefId).toBe(testSwarm.ingestRefId);

      // Verify wizard configuration data exposure
      expect(data.data.wizardStep).toBe(testSwarm.wizardStep);
      expect(data.data.stepStatus).toBe(testSwarm.stepStatus);
      expect(data.data.wizardData).toBeDefined();
      expect(data.data.wizardData.sensitiveConfig).toBeDefined();
      expect(data.data.wizardData.sensitiveConfig.apiKeys).toEqual(["key1", "key2"]);
      expect(data.data.wizardData.sensitiveConfig.secrets.dbPassword).toBe("super_secret_db_pass");

      // Verify services configuration exposure
      expect(data.data.services).toHaveLength(1);
      expect(data.data.services[0].name).toBe("web");
      expect(data.data.services[0].port).toBe(3000);
      expect(data.data.services[0].env.NODE_ENV).toBe("production");

      // Verify user data exposure
      expect(data.data.user.id).toBe(testUser.id);
      expect(data.data.user.email).toBe(testUser.email);
      expect(data.data.user.name).toBe(testUser.name);

      // Verify workspace validation was called
      expect(mockValidateUserWorkspaceAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          user: { id: testUser.id, email: testUser.email }
        }),
        testWorkspace.slug
      );
    });

    test("should return 401 for unauthenticated user", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/code-graph/wizard-state?workspace=test-workspace"
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    test("should return 400 for missing workspace parameter", async () => {
      const { testUser } = await createTestUserWithWorkspace();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/code-graph/wizard-state");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Workspace slug is required");
    });

    test("should return 403 for denied workspace access", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock workspace validation failure
      mockValidateUserWorkspaceAccess.mockResolvedValue(null);

      const request = new NextRequest(
        `http://localhost:3000/api/code-graph/wizard-state?workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Access denied to workspace");
    });

    test("should return 404 for non-existent workspace", async () => {
      const { testUser } = await createTestUserWithWorkspace();
      const nonExistentSlug = "non-existent-workspace";
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock validation success but workspace doesn't exist in database
      mockValidateUserWorkspaceAccess.mockResolvedValue(nonExistentSlug);

      const request = new NextRequest(
        `http://localhost:3000/api/code-graph/wizard-state?workspace=${nonExistentSlug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Workspace not found");
    });

    test("should return 200 with error message when no swarm exists", async () => {
      const { testUser } = await createTestUserWithWorkspace();
      
      // Create workspace without swarm
      const workspaceWithoutSwarm = await db.workspace.create({
        data: {
          id: `test-workspace-no-swarm-${Date.now()}`,
          name: "Workspace Without Swarm",
          slug: `workspace-no-swarm-${Date.now()}`,
          description: "Test workspace without swarm",
          ownerId: testUser.id,
          deleted: false,
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockValidateUserWorkspaceAccess.mockResolvedValue(workspaceWithoutSwarm.slug);

      const request = new NextRequest(
        `http://localhost:3000/api/code-graph/wizard-state?workspace=${workspaceWithoutSwarm.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.message).toBe("No swarm found for workspace");
    });

    test("should handle malformed JSON in wizard data gracefully", async () => {
      // Create a separate workspace for this test to avoid unique constraint conflict
      const malformedTestWorkspace = await db.$transaction(async (tx) => {
        const testUser = await tx.user.create({
          data: {
            id: `test-user-mal-${Date.now()}-${Math.random()}`,
            email: `test-mal-${Date.now()}@example.com`,
            name: "Test User Malformed",
          },
        });

        const testWorkspace = await tx.workspace.create({
          data: {
            id: `test-workspace-mal-${Date.now()}-${Math.random()}`,
            name: "Test Workspace Malformed",
            slug: `test-workspace-mal-${Date.now()}`,
            description: "Test workspace for malformed testing",
            ownerId: testUser.id,
            deleted: false,
          },
        });

        return { testUser, testWorkspace };
      });

      // Create swarm with malformed wizard data
      const swarmWithBadData = await db.swarm.create({
        data: {
          id: `test-swarm-bad-json-${Date.now()}`,
          swarmId: "test-swarm-bad-json",
          name: "Swarm with Bad JSON",
          status: "ACTIVE",
          instanceType: "XL",
          repositoryName: "test-repo-bad",
          repositoryUrl: "https://github.com/testuser/test-repo-bad",
          defaultBranch: "main",
          wizardStep: "WELCOME",
          stepStatus: "PENDING",
          wizardData: "{ invalid json malformed",
          services: [],
          workspaceId: malformedTestWorkspace.testWorkspace.id,
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: malformedTestWorkspace.testUser.id, email: malformedTestWorkspace.testUser.email },
      });

      mockValidateUserWorkspaceAccess.mockResolvedValue(malformedTestWorkspace.testWorkspace.slug);

      const request = new NextRequest(
        `http://localhost:3000/api/code-graph/wizard-state?workspace=${malformedTestWorkspace.testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.wizardData).toEqual({}); // Should default to empty object
    });

    test("should handle database errors gracefully", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockValidateUserWorkspaceAccess.mockResolvedValue(testWorkspace.slug);

      // Mock database error by using invalid database query
      const originalFindFirst = db.workspace.findFirst;
      vi.spyOn(db.workspace, 'findFirst').mockRejectedValueOnce(new Error("Database connection failed"));

      const request = new NextRequest(
        `http://localhost:3000/api/code-graph/wizard-state?workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Internal server error");
      expect(data.error).toBe("Database connection failed");
    });

    test("should properly parse and expose object-type wizard data", async () => {
      // Create a separate workspace for this test to avoid unique constraint conflict
      const objectTestWorkspace = await db.$transaction(async (tx) => {
        const testUser = await tx.user.create({
          data: {
            id: `test-user-obj-${Date.now()}-${Math.random()}`,
            email: `test-obj-${Date.now()}@example.com`,
            name: "Test User Object",
          },
        });

        const testWorkspace = await tx.workspace.create({
          data: {
            id: `test-workspace-obj-${Date.now()}-${Math.random()}`,
            name: "Test Workspace Object",
            slug: `test-workspace-obj-${Date.now()}`,
            description: "Test workspace for object testing",
            ownerId: testUser.id,
            deleted: false,
          },
        });

        return { testUser, testWorkspace };
      });

      // Create swarm with object wizard data (not string)
      const objectWizardData = {
        configStep: "advanced",
        settings: {
          autoScale: true,
          maxInstances: 10,
          secrets: ["secret1", "secret2"],
        },
      };

      const swarmWithObjectData = await db.swarm.create({
        data: {
          id: `test-swarm-object-${Date.now()}`,
          swarmId: "test-swarm-object",
          name: "Swarm with Object Data",
          status: "ACTIVE",
          instanceType: "L",
          repositoryName: "test-repo-obj",
          repositoryUrl: "https://github.com/testuser/test-repo-obj",
          defaultBranch: "main",
          wizardStep: "PROJECT_NAME",
          stepStatus: "PROCESSING",
          wizardData: objectWizardData,
          services: [],
          workspaceId: objectTestWorkspace.testWorkspace.id,
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: objectTestWorkspace.testUser.id, email: objectTestWorkspace.testUser.email },
      });

      mockValidateUserWorkspaceAccess.mockResolvedValue(objectTestWorkspace.testWorkspace.slug);

      const request = new NextRequest(
        `http://localhost:3000/api/code-graph/wizard-state?workspace=${objectTestWorkspace.testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.wizardData).toEqual(objectWizardData);
      expect(data.data.wizardData.settings.secrets).toEqual(["secret1", "secret2"]);
    });

    test("should validate session user ID structure", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();
      
      // Mock session with missing user ID
      mockGetServerSession.mockResolvedValue({
        user: { email: testUser.email }, // Missing id field
      });

      const request = new NextRequest(
        `http://localhost:3000/api/code-graph/wizard-state?workspace=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });
  });
});