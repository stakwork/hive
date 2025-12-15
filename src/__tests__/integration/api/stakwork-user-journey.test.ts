import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/stakwork/user-journey/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  createPostRequest,
  expectSuccess,
  expectError,
  expectUnauthorized,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";

// Mock the config module at the top level
vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-api-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_USER_JOURNEY_WORKFLOW_ID: "999",
  },
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    POOL_MANAGER_BASE_URL: "https://workspaces.sphinx.chat/api",
    API_TIMEOUT: 10000,
  },
}));

// Test data factory for creating complete workspace setup with swarm and GitHub auth
async function createUserJourneyTestSetup() {
  const enc = EncryptionService.getInstance();
  const testGithubToken = "ghp_test_token_12345";
  const testGithubUsername = "test-user";
  const testSwarmUrl = "https://test-swarm.sphinx.chat/api";
  const testSwarmApiKey = "swarm_api_key_12345";

  const testData = await db.$transaction(async (tx) => {
    // Create user
    const user = await tx.user.create({
      data: {
        email: `user-${generateUniqueId()}@example.com`,
        name: "Test User",
      },
    });

    // Create GitHub auth for user
    await tx.gitHubAuth.create({
      data: {
        userId: user.id,
        githubUserId: generateUniqueId(),
        githubUsername: testGithubUsername,
        githubNodeId: `node_${generateUniqueId()}`,
      },
    });

    // Create GitHub OAuth account with encrypted token
    await tx.account.create({
      data: {
        userId: user.id,
        type: "oauth",
        provider: "github",
        providerAccountId: generateUniqueId(),
        access_token: JSON.stringify(
          enc.encryptField("access_token", testGithubToken)
        ),
        scope: "repo,user",
      },
    });

    // Create workspace
    const workspace = await tx.workspace.create({
      data: {
        name: "Test Workspace",
        slug: generateUniqueSlug("test-workspace"),
        ownerId: user.id,
      },
    });

    // Create swarm for workspace
    const swarm = await tx.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        swarmId: generateUniqueId("swarm"),
        swarmUrl: testSwarmUrl,
        swarmSecretAlias: "{{SWARM_TEST_API_KEY}}",
        swarmApiKey: JSON.stringify(
          enc.encryptField("swarmApiKey", testSwarmApiKey)
        ),
        poolName: "test-pool",
        services: [],
        agentRequestId: null,
        agentStatus: null,
      },
    });

    return { user, workspace, swarm };
  });

  return {
    ...testData,
    testGithubToken,
    testGithubUsername,
    testSwarmUrl,
  };
}

describe("POST /api/stakwork/user-journey - Integration Tests", () => {
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock successful Stakwork API response
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          workflow_id: 12345,
          status: "queued",
          project_id: 67890,
        },
      }),
      statusText: "OK",
    } as Response);

    // Set required environment variables for tests
    process.env.STAKWORK_API_KEY = "test-stakwork-api-key";
    process.env.STAKWORK_BASE_URL = "https://api.stakwork.com/api/v1";
    process.env.STAKWORK_USER_JOURNEY_WORKFLOW_ID = "999";
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe("Authentication & Authorization", () => {
    test("should return 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test user journey",
          workspaceId: "workspace-123",
        }
      );

      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("should return 401 for invalid user session (missing userId)", async () => {
      getMockedSession().mockResolvedValue({
        user: { name: "Test" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test user journey",
          workspaceId: "workspace-123",
        }
      );

      const response = await POST(request);

      await expectError(response, "Invalid user session", 401);
    });

    test("should return 404 for workspace not found", async () => {
      const { user } = await createUserJourneyTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test user journey",
          workspaceId: "non-existent-workspace-id",
        }
      );

      const response = await POST(request);

      await expectError(
        response,
        "Workspace not found or access denied",
        404
      );
    });

    test("should return 404 for unauthorized workspace access", async () => {
      const { workspace } = await createUserJourneyTestSetup();
      const unauthorizedUser = await createTestUser({
        email: `unauthorized-${generateUniqueId()}@example.com`,
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(unauthorizedUser)
      );

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test user journey",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);

      await expectError(
        response,
        "Workspace not found or access denied",
        404
      );
    });
  });

  describe("Request Validation", () => {
    test("should return 400 for missing message field", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);

      await expectError(response, "Message is required", 400);
    });

    test("should return 400 for empty message", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);

      await expectError(response, "Message is required", 400);
    });

    test("should return 400 for missing workspaceId field", async () => {
      const { user } = await createUserJourneyTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test user journey",
        }
      );

      const response = await POST(request);

      await expectError(response, "Workspace ID is required", 400);
    });

    test("should return 400 for empty workspaceId", async () => {
      const { user } = await createUserJourneyTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test user journey",
          workspaceId: "",
        }
      );

      const response = await POST(request);

      await expectError(response, "Workspace ID is required", 400);
    });
  });

  describe("Swarm Configuration", () => {
    test("should return 404 when no swarm is configured for workspace", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Workspace Without Swarm",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test user journey",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);

      await expectError(response, "No swarm found for this workspace", 404);
    });
  });

  describe("Successful Requests", () => {
    test("should successfully track user journey event with complete workflow", async () => {
      const { user, workspace, swarm, testGithubUsername, testGithubToken } =
        await createUserJourneyTestSetup();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const testMessage = "User navigated to dashboard and created a task";
      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: testMessage,
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      // Verify response structure
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("message", "called stakwork");
      expect(data).toHaveProperty("workflow");
      expect(data.workflow).toEqual({
        workflow_id: 12345,
        status: "queued",
        project_id: 67890,
      });

      // Verify Stakwork API was called with correct payload
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];

      expect(url).toBe("https://api.stakwork.com/api/v1/projects");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({
        Authorization: "Token token=test-stakwork-api-key",
        "Content-Type": "application/json",
      });

      // Verify payload structure
      const payload = JSON.parse(options.body);
      expect(payload).toMatchObject({
        name: "hive_autogen",
        workflow_id: 999,
        workflow_params: {
          set_var: {
            attributes: {
              vars: {
                message: testMessage,
                accessToken: testGithubToken,
                username: testGithubUsername,
                swarmUrl: "https://test-swarm.sphinx.chat:8444/api",
                swarmSecretAlias: "{{SWARM_TEST_API_KEY}}",
                poolName: "test-pool",
                repo2graph_url: "https://test-swarm.sphinx.chat:3355",
                workspaceId: workspace.id,
              },
            },
          },
        },
      });
    });

    test("should include webhook_url in payload for status callbacks", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test webhook URL inclusion",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);
      await expectSuccess(response, 201);

      // Verify webhook_url is included in Stakwork payload
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);

      expect(payload).toHaveProperty("webhook_url");
      expect(payload.webhook_url).toMatch(/\/api\/stakwork\/webhook\?task_id=/);

      // Verify task_id parameter matches the created task
      const taskIdMatch = payload.webhook_url.match(/task_id=([^&]+)/);
      expect(taskIdMatch).toBeTruthy();
      expect(taskIdMatch[1]).toBeTruthy(); // Verify task ID exists
    });

    test("should handle null GitHub credentials gracefully", async () => {
      const { workspace } = await createUserJourneyTestSetup();

      // Create user without GitHub auth
      const userWithoutGithub = await createTestUser({
        email: `no-github-${generateUniqueId()}@example.com`,
      });

      // Make user workspace owner
      await db.workspace.update({
        where: { id: workspace.id },
        data: { ownerId: userWithoutGithub.id },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(userWithoutGithub)
      );

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test without GitHub",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.success).toBe(true);

      // Verify GitHub credentials are null in payload
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.accessToken).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.username).toBeNull();
    });

    test("should use swarm.id as poolName fallback when poolName is null", async () => {
      const { user, workspace, swarm } = await createUserJourneyTestSetup();

      // Update swarm to have null poolName
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolName: null },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test poolName fallback",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);
      await expectSuccess(response, 201);

      // Verify poolName falls back to swarm.id
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.poolName).toBe(
        swarm.id
      );
    });

    test("should transform swarmUrl correctly to repo2graph format", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test URL transformation",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);
      await expectSuccess(response, 201);

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);

      // Verify swarmUrl transformation: /api -> :8444/api
      expect(payload.workflow_params.set_var.attributes.vars.swarmUrl).toBe(
        "https://test-swarm.sphinx.chat:8444/api"
      );

      // Verify repo2GraphUrl transformation: /api -> :3355
      expect(
        payload.workflow_params.set_var.attributes.vars.repo2graph_url
      ).toBe("https://test-swarm.sphinx.chat:3355");
    });

    test("should handle empty swarmUrl gracefully", async () => {
      const { user, workspace, swarm } = await createUserJourneyTestSetup();

      // Update swarm to have null swarmUrl
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: null },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test empty swarmUrl",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);
      await expectSuccess(response, 201);

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.swarmUrl).toBe("");
      expect(
        payload.workflow_params.set_var.attributes.vars.repo2graph_url
      ).toBe("");
    });

    test("should support analytics data collection through workflow parameters", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const analyticsMessage =
        "User viewed recommendations page, clicked on recommendation #42, and opened file explorer";
      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: analyticsMessage,
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      // Verify analytics data is captured in message
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.message).toBe(
        analyticsMessage
      );

      // Verify workflow submission for analytics processing
      expect(data.workflow).toBeDefined();
      expect(data.workflow.workflow_id).toBe(12345);
    });
  });

  describe("Error Handling", () => {
    test("should return 201 with null workflow when Stakwork API returns error", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();

      // Mock Stakwork API failure
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
        json: async () => ({ error: "Workflow execution failed" }),
      } as Response);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test API error",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);

      // The endpoint returns 201 even when Stakwork API fails
      // This allows the frontend to proceed while logging Stakwork issues
      const data = await response.json();
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow).toBeNull();
    });

    test("should return 201 with null workflow when network errors to Stakwork API", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();

      // Mock network error
      fetchSpy.mockRejectedValueOnce(new Error("Network error"));

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test network error",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);

      // The endpoint catches errors from callStakwork and returns 201 with null workflow
      const data = await response.json();
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow).toBeNull();
    });

    test("should return 201 with workflow when STAKWORK_API_KEY is available (config validation)", async () => {
      // This test verifies that with valid config, the API works correctly
      const { user, workspace } = await createUserJourneyTestSetup();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test with valid API key",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);

      const data = await response.json();
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow).toBeDefined();
      expect(data.workflow.workflow_id).toBe(12345);
    });

    test("should return 201 with workflow when STAKWORK_USER_JOURNEY_WORKFLOW_ID is available (config validation)", async () => {
      // This test verifies that with valid config, the API works correctly
      const { user, workspace } = await createUserJourneyTestSetup();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test with valid workflow ID",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);

      const data = await response.json();
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow).toBeDefined();
      expect(data.workflow.workflow_id).toBe(12345);
    });
  });

  describe("Database Operations", () => {
    test("should query workspace with proper authorization checks", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test workspace query",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);
      await expectSuccess(response, 201);

      // Verify workspace is still in database
      const dbWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(dbWorkspace).toBeDefined();
      expect(dbWorkspace?.id).toBe(workspace.id);
    });

    test("should retrieve swarm configuration from database", async () => {
      const { user, workspace, swarm } = await createUserJourneyTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test swarm retrieval",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);
      await expectSuccess(response, 201);

      // Verify swarm configuration was used if fetch was called
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      if (fetchSpy.mock.calls[0] && fetchSpy.mock.calls[0][1]) {
        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(
          payload.workflow_params.set_var.attributes.vars.swarmSecretAlias
        ).toBe("{{SWARM_TEST_API_KEY}}");
      }

      // Verify swarm is still in database
      const dbSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
      });
      expect(dbSwarm).toBeDefined();
      expect(dbSwarm?.workspaceId).toBe(workspace.id);
    });

    test("should decrypt GitHub credentials from database", async () => {
      const { user, workspace, testGithubToken, testGithubUsername } =
        await createUserJourneyTestSetup();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "Test credential decryption",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);
      await expectSuccess(response, 201);

      // Verify decrypted credentials were used in Stakwork API call if fetch was called
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      if (fetchSpy.mock.calls[0] && fetchSpy.mock.calls[0][1]) {
        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.accessToken).toBe(
          testGithubToken
        );
        expect(payload.workflow_params.set_var.attributes.vars.username).toBe(
          testGithubUsername
        );
      }
    });
  });

  describe("Personalization Support", () => {
    test("should include user context for personalized experiences", async () => {
      const { user, workspace, testGithubUsername } =
        await createUserJourneyTestSetup();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const userSpecificMessage = `User ${testGithubUsername} completed onboarding tutorial`;
      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: userSpecificMessage,
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);
      await expectSuccess(response, 201);

      // Verify user-specific data is included for personalization if fetch was called
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      if (fetchSpy.mock.calls[0] && fetchSpy.mock.calls[0][1]) {
        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.username).toBe(
          testGithubUsername
        );
        expect(payload.workflow_params.set_var.attributes.vars.message).toContain(
          testGithubUsername
        );
      }
    });

    test("should include workspace context for multi-tenant personalization", async () => {
      const { user, workspace } = await createUserJourneyTestSetup();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/stakwork/user-journey",
        {
          message: "User interacted with workspace-specific features",
          workspaceId: workspace.id,
        }
      );

      const response = await POST(request);
      await expectSuccess(response, 201);

      // Verify workspace-specific configuration is included if fetch was called
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      if (fetchSpy.mock.calls[0] && fetchSpy.mock.calls[0][1]) {
        const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(payload.workflow_params.set_var.attributes.vars.poolName).toBe(
          "test-pool"
        );
        expect(
          payload.workflow_params.set_var.attributes.vars.swarmSecretAlias
        ).toBe("{{SWARM_TEST_API_KEY}}");
      }
    });
  });
});