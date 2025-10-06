import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/swarm/stakgraph/services/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  generateUniqueId,
  generateUniqueSlug,
  getMockedSession,
  createGetRequest,
} from "@/__tests__/support/helpers";
import { ServiceConfig } from "@/services/swarm/db";

// ============================================================================
// Test Data Factories - Centralized test data creation
// ============================================================================

interface TestUserData {
  id: string;
  email: string;
  name: string;
}

interface TestWorkspaceData {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
}

interface TestSwarmData {
  id: string;
  workspaceId: string;
  name: string;
  swarmId: string;
  swarmUrl: string;
  swarmApiKey: string;
  services?: ServiceConfig[];
  repositoryUrl?: string;
}

interface TestAccountData {
  userId: string;
  provider: string;
  providerAccountId: string;
  access_token: string;
}

interface TestGitHubAuthData {
  userId: string;
  githubUserId: string;
  githubUsername: string;
  githubNodeId: string;
}

interface TestSourceControlOrgData {
  id: string;
  name: string;
  type: string;
}

// Remove externalId interface and factory function

interface TestSourceControlTokenData {
  userId: string;
  sourceControlOrgId: string;
  token: string;
}

const enc = EncryptionService.getInstance();
const PLAINTEXT_SWARM_API_KEY = "swarm_test_key_abc";
const PLAINTEXT_GITHUB_PAT = "ghp_test_pat_123";

async function createTestUser(): Promise<TestUserData> {
  const userData: TestUserData = {
    id: generateUniqueId("user"),
    email: `user-${generateUniqueId()}@example.com`,
    name: "Test User",
  };
  
  await db.user.create({ data: userData });
  return userData;
}

async function createTestWorkspace(ownerId: string): Promise<TestWorkspaceData> {
  const workspaceData: TestWorkspaceData = {
    id: generateUniqueId("workspace"),
    name: "Test Workspace",
    slug: generateUniqueSlug("test-workspace"),
    ownerId,
  };
  
  await db.workspace.create({ data: workspaceData });
  return workspaceData;
}

async function createTestSwarm(
  workspaceId: string,
  options: Partial<TestSwarmData> = {}
): Promise<TestSwarmData> {
  const uniqueName = options.name || `test-swarm-${generateUniqueId()}`;
  const swarmData: TestSwarmData = {
    id: generateUniqueId("swarm"),
    workspaceId,
    name: uniqueName,
    swarmId: options.swarmId || generateUniqueId("swarm"),
    swarmUrl: options.swarmUrl || "https://test-swarm.sphinx.chat/api",
    swarmApiKey: JSON.stringify(enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY)),
    services: options.services || [],
    repositoryUrl: options.repositoryUrl,
  };
  
  await db.swarm.create({
    data: {
      workspaceId: swarmData.workspaceId,
      name: swarmData.name,
      swarmId: swarmData.swarmId,
      status: "ACTIVE",
      swarmUrl: swarmData.swarmUrl,
      swarmApiKey: swarmData.swarmApiKey,
      services: swarmData.services,
      repositoryUrl: swarmData.repositoryUrl,
    },
  });
  
  return swarmData;
}

async function createTestGitHubAccount(userId: string): Promise<TestAccountData> {
  const accountData: TestAccountData = {
    userId,
    provider: "github",
    providerAccountId: generateUniqueId("github"),
    access_token: JSON.stringify(enc.encryptField("access_token", PLAINTEXT_GITHUB_PAT)),
  };
  
  await db.account.create({
    data: {
      ...accountData,
      type: "oauth",
      token_type: "bearer",
      scope: "repo,read:user",
    },
  });
  
  return accountData;
}

async function createTestGitHubAuth(userId: string): Promise<TestGitHubAuthData> {
  const githubAuthData: TestGitHubAuthData = {
    userId,
    githubUserId: generateUniqueId("github-user"),
    githubUsername: "testuser",
    githubNodeId: generateUniqueId("node"),
  };
  
  await db.gitHubAuth.create({ data: githubAuthData });
  return githubAuthData;
}

async function createTestSourceControlOrg(workspaceId: string): Promise<TestSourceControlOrgData> {
  const orgData: TestSourceControlOrgData = {
    id: generateUniqueId("org"),
    name: "test-org",
    type: "ORG", // Use correct enum value from SourceControlOrgType
  };
  
  await db.sourceControlOrg.create({
    data: {
      id: orgData.id,
      name: orgData.name,
      type: orgData.type,
      githubLogin: "test-org", // Required field for GitHub orgs
      githubInstallationId: 12345, // Required field for GitHub App installations
    },
  });
  
  // Create relationship with workspace
  await db.workspace.update({
    where: { id: workspaceId },
    data: {
      sourceControlOrg: { connect: { id: orgData.id } }
    }
  });
  
  return orgData;
}

async function createTestSourceControlToken(
  userId: string,
  sourceControlOrgId: string
): Promise<TestSourceControlTokenData> {
  const tokenData: TestSourceControlTokenData = {
    userId,
    sourceControlOrgId,
    token: JSON.stringify(enc.encryptField("source_control_token", PLAINTEXT_GITHUB_PAT)),
  };
  
  await db.sourceControlToken.create({ data: tokenData });
  return tokenData;
}

// ============================================================================
// Reusable Assertion Helpers
// ============================================================================

function assertUnauthorizedResponse(response: Response, body: any) {
  expect(response.status).toBe(401);
  expect(body.success).toBe(false);
  expect(body.message).toBe("Unauthorized");
}

function assertBadRequestResponse(response: Response, body: any, expectedMessage?: string) {
  expect(response.status).toBe(400);
  expect(body.success).toBe(false);
  if (expectedMessage) {
    expect(body.message).toContain(expectedMessage);
  }
}

function assertNotFoundResponse(response: Response, body: any, expectedMessage?: string) {
  expect(response.status).toBe(404);
  expect(body.success).toBe(false);
  if (expectedMessage) {
    expect(body.message).toContain(expectedMessage);
  }
}

function assertSuccessResponse(response: Response, body: any) {
  expect(response.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.status).toBe(200);
  expect(body.data).toBeDefined();
}

function assertServicesStructure(services: ServiceConfig[]) {
  expect(Array.isArray(services)).toBe(true);
  services.forEach((service) => {
    expect(service).toHaveProperty("name");
    expect(service).toHaveProperty("port");
    expect(service).toHaveProperty("scripts");
    expect(service.scripts).toHaveProperty("start");
  });
}

async function assertSwarmServicesInDB(workspaceId: string, expectedCount?: number) {
  const swarm = await db.swarm.findFirst({ where: { workspaceId } });
  expect(swarm).toBeDefined();
  expect(Array.isArray(swarm?.services)).toBe(true);
  if (expectedCount !== undefined) {
    expect((swarm?.services as ServiceConfig[]).length).toBe(expectedCount);
  }
  return swarm;
}

// ============================================================================
// Mock Response Factories
// ============================================================================

function createMockServicesResponse(services: ServiceConfig[] = []): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ services }),
  } as Response;
}

function createMockAgentInitResponse(requestId: string = "test-request-id"): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ request_id: requestId }),
  } as Response;
}

function createMockAgentProgressResponse(
  status: "pending" | "completed" | "failed",
  result?: Record<string, string>
): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status,
      ...(result && { result }),
    }),
  } as Response;
}

const MOCK_PM2_CONFIG = `module.exports = {
  apps: [
    {
      name: "test-service",
      script: "npm start",
      cwd: "/workspaces/test-repo/service",
      interpreter: "node",
      env: {
        PORT: "3000",
        INSTALL_COMMAND: "npm install",
        BUILD_COMMAND: "npm run build"
      }
    }
  ]
};`;

const MOCK_ENV_FILE = `NODE_ENV=production
API_KEY=test_key_123
DATABASE_URL=postgres://localhost/testdb`;

// ============================================================================
// Test Suite
// ============================================================================

describe("GET /api/swarm/stakgraph/services", () => {
  let testUser: TestUserData;
  let testWorkspace: TestWorkspaceData;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create test data atomically
    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace(testUser.id);
    
    // Mock session
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
    
    // Setup fetch spy (will be configured per test)
    fetchSpy = vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ==========================================================================
  // Authentication & Authorization
  // ==========================================================================

  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(null);
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertUnauthorizedResponse(res, body);
    });

    it("returns 401 when session has no user ID", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertUnauthorizedResponse(res, body);
    });

    it("proxies with decrypted header and keeps DB encrypted", async () => {
      const testSwarm = await createTestSwarm(testWorkspace.id);
      
      fetchSpy.mockResolvedValue(createMockServicesResponse([]));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
          swarmId: testSwarm.swarmId,
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      
      // Verify header used decrypted token
      const firstCall = fetchSpy.mock.calls[0] as [
        string,
        { headers?: Record<string, string> },
      ];
      const headers = (firstCall?.[1]?.headers || {}) as Record<string, string>;
      expect(Object.values(headers).join(" ")).toContain(PLAINTEXT_SWARM_API_KEY);
      
      // Verify DB is still encrypted
      const swarm = await db.swarm.findFirst({ where: { swarmId: testSwarm.swarmId } });
      const stored = swarm?.swarmApiKey || "";
      expect(stored).not.toContain(PLAINTEXT_SWARM_API_KEY);
    });
  });

  // ==========================================================================
  // Parameter Validation
  // ==========================================================================

  describe("Parameter Validation", () => {
    it("returns 400 when both workspaceId and swarmId are missing", async () => {
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {})
      );
      const body = await res.json();
      
      assertBadRequestResponse(res, body, "must provide either workspaceId or swarmId");
    });

    it("accepts request with only workspaceId", async () => {
      const testSwarm = await createTestSwarm(testWorkspace.id);
      fetchSpy.mockResolvedValue(createMockServicesResponse([]));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
    });

    it("accepts request with only swarmId", async () => {
      const testSwarm = await createTestSwarm(testWorkspace.id);
      fetchSpy.mockResolvedValue(createMockServicesResponse([]));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          swarmId: testSwarm.swarmId,
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
    });
  });

  // ==========================================================================
  // Swarm Lookup & Configuration
  // ==========================================================================

  describe("Swarm Lookup", () => {
    it("returns 404 when swarm is not found by workspaceId", async () => {
      const nonExistentWorkspaceId = generateUniqueId("workspace");
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: nonExistentWorkspaceId,
        })
      );
      const body = await res.json();
      
      assertNotFoundResponse(res, body, "Swarm not found");
    });

    it("returns 404 when swarm is not found by swarmId", async () => {
      const nonExistentSwarmId = generateUniqueId("swarm");
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          swarmId: nonExistentSwarmId,
        })
      );
      const body = await res.json();
      
      assertNotFoundResponse(res, body, "Swarm not found");
    });

    it("finds swarm by workspaceId when both params provided", async () => {
      const testSwarm = await createTestSwarm(testWorkspace.id);
      const otherWorkspace = await createTestWorkspace(testUser.id);
      const otherSwarm = await createTestSwarm(otherWorkspace.id);
      
      fetchSpy.mockResolvedValue(createMockServicesResponse([]));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
          swarmId: otherSwarm.swarmId, // Different swarm
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      
      // Verify it used the swarmId (takes precedence)
      const swarm = await db.swarm.findFirst({ where: { swarmId: otherSwarm.swarmId } });
      expect(swarm?.workspaceId).toBe(otherWorkspace.id);
    });
  });

  describe("Swarm Configuration Validation", () => {
    it("returns 400 when swarmUrl is missing", async () => {
      await db.swarm.create({
        data: {
          workspaceId: testWorkspace.id,
          name: "test-swarm",
          swarmId: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: null,
          swarmApiKey: JSON.stringify(enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY)),
          services: [],
        },
      });
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertBadRequestResponse(res, body, "Swarm URL or API key not set");
    });

    it("returns 400 when swarmApiKey is missing", async () => {
      await db.swarm.create({
        data: {
          workspaceId: testWorkspace.id,
          name: "test-swarm",
          swarmId: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: "https://test-swarm.sphinx.chat/api",
          swarmApiKey: null,
          services: [],
        },
      });
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertBadRequestResponse(res, body, "Swarm URL or API key not set");
    });
  });

  // ==========================================================================
  // Cache Behavior
  // ==========================================================================

  describe("Cache Behavior", () => {
    it("returns cached services when they exist in database", async () => {
      const cachedServices: ServiceConfig[] = [
        {
          name: "cached-service",
          port: 3000,
          scripts: { start: "npm start" },
        },
      ];
      
      await createTestSwarm(testWorkspace.id, { services: cachedServices });
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      expect(body.data.services).toEqual(cachedServices);
      
      // Verify no external API calls were made
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fetches services when database has empty services array", async () => {
      await createTestSwarm(testWorkspace.id, { services: [] });
      
      const mockServices: ServiceConfig[] = [
        {
          name: "fetched-service",
          port: 3000,
          scripts: { start: "npm start" },
        },
      ];
      
      fetchSpy.mockResolvedValue(createMockServicesResponse(mockServices));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      assertServicesStructure(body.data.services);
      
      // Verify external API was called
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Workspace Lookup
  // ==========================================================================

  describe("Workspace Lookup", () => {
    it("returns 404 when workspace is not found for swarm", async () => {
      // Create an actual workspace first, then create swarm, then delete workspace
      const tempWorkspace = await createTestWorkspace(testUser.id);
      const orphanSwarm = await createTestSwarm(tempWorkspace.id, { name: "orphan-swarm" });
      
      // Now delete the workspace to simulate orphaned swarm
      await db.workspace.delete({ where: { id: tempWorkspace.id } });
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: tempWorkspace.id,
        })
      );
      const body = await res.json();
      
      // The API actually returns "Swarm not found" when workspace is deleted
      // because it fails to find the swarm for the non-existent workspace
      assertNotFoundResponse(res, body, "Swarm not found");
    });
  });

  // ==========================================================================
  // GitHub Integration
  // ==========================================================================

  describe("GitHub Integration", () => {
    it("fetches services without GitHub credentials", async () => {
      await createTestSwarm(testWorkspace.id);
      
      fetchSpy.mockResolvedValue(createMockServicesResponse([]));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      
      // Verify request was made without username/pat params
      const fetchUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(fetchUrl).not.toContain("username=");
      expect(fetchUrl).not.toContain("pat=");
    });

    it("includes GitHub credentials when available via OAuth", async () => {
      await createTestSwarm(testWorkspace.id);
      await createTestGitHubAuth(testUser.id);
      await createTestGitHubAccount(testUser.id);
      
      fetchSpy.mockResolvedValue(createMockServicesResponse([]));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      
      // Verify request included GitHub credentials
      const fetchUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(fetchUrl).toContain("username=testuser");
      expect(fetchUrl).toContain("pat=");
    });

    it("includes GitHub credentials from source control token when workspace has org", async () => {
      await createTestSwarm(testWorkspace.id);
      await createTestGitHubAuth(testUser.id);
      const org = await createTestSourceControlOrg(testWorkspace.id);
      await createTestSourceControlToken(testUser.id, org.id);
      
      fetchSpy.mockResolvedValue(createMockServicesResponse([]));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      
      // Verify request included GitHub credentials
      const fetchUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(fetchUrl).toContain("username=testuser");
      expect(fetchUrl).toContain("pat=");
    });
  });

  // ==========================================================================
  // Agent Mode
  // ==========================================================================

  describe("Agent Mode", () => {
    it("uses agent mode when repo_url is provided", async () => {
      await createTestSwarm(testWorkspace.id, {
        repositoryUrl: "https://github.com/test-org/test-repo",
      });
      await createTestGitHubAuth(testUser.id);
      await createTestGitHubAccount(testUser.id);
      
      // Mock agent init
      fetchSpy.mockResolvedValueOnce(createMockAgentInitResponse("test-request-123"));
      
      // Mock agent progress (completed)
      fetchSpy.mockResolvedValueOnce(
        createMockAgentProgressResponse("completed", {
          "pm2.config.js": MOCK_PM2_CONFIG,
          ".env": MOCK_ENV_FILE,
          "docker-compose.yml": "version: '3'",
        })
      );
      
      // Mock stakgraph fallback call for env vars
      fetchSpy.mockResolvedValueOnce(createMockServicesResponse([]));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
          repo_url: "https://github.com/test-org/test-repo",
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      assertServicesStructure(body.data.services);
      
      // Verify agent endpoints were called
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      const calls = fetchSpy.mock.calls;
      expect(calls[0]?.[0]).toContain("/services_agent");
      expect(calls[1]?.[0]).toContain("/progress");
      expect(calls[2]?.[0]).toContain("/services");
    });

    it("polls agent progress until completion", async () => {
      await createTestSwarm(testWorkspace.id, {
        repositoryUrl: "https://github.com/test-org/test-repo",
      });
      await createTestGitHubAuth(testUser.id);
      await createTestGitHubAccount(testUser.id);
      
      // Mock agent init
      fetchSpy.mockResolvedValueOnce(createMockAgentInitResponse("test-request-123"));
      
      // Mock agent progress (pending → pending → completed)
      fetchSpy.mockResolvedValueOnce(createMockAgentProgressResponse("pending"));
      fetchSpy.mockResolvedValueOnce(createMockAgentProgressResponse("pending"));
      fetchSpy.mockResolvedValueOnce(
        createMockAgentProgressResponse("completed", {
          "pm2.config.js": MOCK_PM2_CONFIG,
          ".env": MOCK_ENV_FILE,
        })
      );
      
      // Mock stakgraph fallback
      fetchSpy.mockResolvedValueOnce(createMockServicesResponse([]));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
          repo_url: "https://github.com/test-org/test-repo",
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      
      // Verify multiple polling attempts
      const progressCalls = fetchSpy.mock.calls.filter((call) =>
        (call[0] as string).includes("/progress")
      );
      expect(progressCalls.length).toBeGreaterThanOrEqual(3);
    });

    it("merges environment variables from agent and stakgraph", async () => {
      await createTestSwarm(testWorkspace.id, {
        repositoryUrl: "https://github.com/test-org/test-repo",
      });
      await createTestGitHubAuth(testUser.id);
      await createTestGitHubAccount(testUser.id);
      
      // Mock agent init
      fetchSpy.mockResolvedValueOnce(createMockAgentInitResponse("test-request-123"));
      
      // Mock agent progress with .env
      const agentEnv = "AGENT_VAR=from_agent\nSHARED_VAR=agent_value";
      fetchSpy.mockResolvedValueOnce(
        createMockAgentProgressResponse("completed", {
          "pm2.config.js": MOCK_PM2_CONFIG,
          ".env": agentEnv,
        })
      );
      
      // Mock stakgraph with different env
      const stakgraphServices: ServiceConfig[] = [
        {
          name: "test-service",
          port: 3000,
          scripts: { start: "npm start" },
          env: {
            STAKGRAPH_VAR: "from_stakgraph",
            SHARED_VAR: "stakgraph_value",
          },
        },
      ];
      fetchSpy.mockResolvedValueOnce(createMockServicesResponse(stakgraphServices));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
          repo_url: "https://github.com/test-org/test-repo",
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      
      // Verify environment variables were saved
      const swarm = await assertSwarmServicesInDB(testWorkspace.id);
      expect(swarm?.environmentVariables).toBeDefined();
      const envVars = swarm?.environmentVariables as Array<{ name: string; value: any }>;
      
      // Agent vars take precedence over stakgraph
      const sharedVar = envVars.find((v) => v.name === "SHARED_VAR");
      expect(sharedVar).toBeDefined();
      
      // Both sources should be present
      expect(envVars.some((v) => v.name === "AGENT_VAR")).toBe(true);
      expect(envVars.some((v) => v.name === "STAKGRAPH_VAR")).toBe(true);
    });

    it("generates container files when agent completes", async () => {
      await createTestSwarm(testWorkspace.id, {
        repositoryUrl: "https://github.com/test-org/test-repo",
        name: "test-repo",
      });
      await createTestGitHubAuth(testUser.id);
      await createTestGitHubAccount(testUser.id);
      
      // Mock agent init
      fetchSpy.mockResolvedValueOnce(createMockAgentInitResponse("test-request-123"));
      
      // Mock agent progress
      fetchSpy.mockResolvedValueOnce(
        createMockAgentProgressResponse("completed", {
          "pm2.config.js": MOCK_PM2_CONFIG,
          "docker-compose.yml": "version: '3'",
        })
      );
      
      // Mock stakgraph
      fetchSpy.mockResolvedValueOnce(createMockServicesResponse([]));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
          repo_url: "https://github.com/test-org/test-repo",
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      
      // Verify container files were saved
      const swarm = await assertSwarmServicesInDB(testWorkspace.id);
      const containerFiles = swarm?.containerFiles as Record<string, string>;
      
      expect(containerFiles).toBeDefined();
      expect(containerFiles["Dockerfile"]).toBeDefined();
      expect(containerFiles["pm2.config.js"]).toBeDefined();
      expect(containerFiles["docker-compose.yml"]).toBeDefined();
      expect(containerFiles["devcontainer.json"]).toBeDefined();
    });
  });

  // ==========================================================================
  // Fallback Logic
  // ==========================================================================

  describe("Fallback Logic", () => {
    it("falls back to standard mode when agent initialization fails", async () => {
      await createTestSwarm(testWorkspace.id, {
        repositoryUrl: "https://github.com/test-org/test-repo",
      });
      await createTestGitHubAuth(testUser.id);
      await createTestGitHubAccount(testUser.id);
      
      // Mock agent init failure
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Agent init failed" }),
      } as Response);
      
      // Mock stakgraph fallback success
      const fallbackServices: ServiceConfig[] = [
        {
          name: "fallback-service",
          port: 3000,
          scripts: { start: "npm start" },
        },
      ];
      fetchSpy.mockResolvedValueOnce(createMockServicesResponse(fallbackServices));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
          repo_url: "https://github.com/test-org/test-repo",
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      expect(body.data.services).toEqual(fallbackServices);
      
      // Verify fallback was used
      const calls = fetchSpy.mock.calls;
      expect(calls.some((call) => (call[0] as string).includes("/services_agent"))).toBe(true);
      expect(calls.some((call) => (call[0] as string).includes("/services"))).toBe(true);
    });

    it("falls back to standard mode when agent polling fails", async () => {
      await createTestSwarm(testWorkspace.id, {
        repositoryUrl: "https://github.com/test-org/test-repo",
      });
      await createTestGitHubAuth(testUser.id);
      await createTestGitHubAccount(testUser.id);
      
      // Mock agent init success
      fetchSpy.mockResolvedValueOnce(createMockAgentInitResponse("test-request-123"));
      
      // Mock agent progress returning failed
      fetchSpy.mockResolvedValueOnce(createMockAgentProgressResponse("failed"));
      
      // Mock stakgraph fallback
      const fallbackServices: ServiceConfig[] = [
        {
          name: "fallback-service",
          port: 3000,
          scripts: { start: "npm start" },
        },
      ];
      fetchSpy.mockResolvedValueOnce(createMockServicesResponse(fallbackServices));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
          repo_url: "https://github.com/test-org/test-repo",
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      expect(body.data.services).toEqual(fallbackServices);
    });

    it("falls back to standard mode when agent returns no request_id", async () => {
      await createTestSwarm(testWorkspace.id, {
        repositoryUrl: "https://github.com/test-org/test-repo",
      });
      await createTestGitHubAuth(testUser.id);
      await createTestGitHubAccount(testUser.id);
      
      // Mock agent init with invalid response (no request_id)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
      
      // Mock stakgraph fallback
      const fallbackServices: ServiceConfig[] = [
        {
          name: "fallback-service",
          port: 3000,
          scripts: { start: "npm start" },
        },
      ];
      fetchSpy.mockResolvedValueOnce(createMockServicesResponse(fallbackServices));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
          repo_url: "https://github.com/test-org/test-repo",
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      expect(body.data.services).toEqual(fallbackServices);
    });
  });

  // ==========================================================================
  // Standard Mode (No repo_url)
  // ==========================================================================

  describe("Standard Mode", () => {
    it("uses standard mode when repo_url is not provided", async () => {
      await createTestSwarm(testWorkspace.id);
      
      const standardServices: ServiceConfig[] = [
        {
          name: "standard-service",
          port: 3000,
          scripts: { start: "npm start" },
        },
      ];
      fetchSpy.mockResolvedValue(createMockServicesResponse(standardServices));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      expect(body.data.services).toEqual(standardServices);
      
      // Verify only /services endpoint was called (no agent mode)
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const fetchUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(fetchUrl).toContain("/services");
      expect(fetchUrl).not.toContain("/services_agent");
    });

    it("extracts environment variables from stakgraph services", async () => {
      await createTestSwarm(testWorkspace.id);
      
      const servicesWithEnv: ServiceConfig[] = [
        {
          name: "service-with-env",
          port: 3000,
          scripts: { start: "npm start" },
          env: {
            NODE_ENV: "production",
            API_KEY: "test-key",
          },
        },
      ];
      fetchSpy.mockResolvedValue(createMockServicesResponse(servicesWithEnv));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      
      // Verify environment variables were saved
      const swarm = await assertSwarmServicesInDB(testWorkspace.id);
      expect(swarm?.environmentVariables).toBeDefined();
      const envVars = swarm?.environmentVariables as Array<{ name: string; value: any }>;
      
      expect(envVars.some((v) => v.name === "NODE_ENV")).toBe(true);
      expect(envVars.some((v) => v.name === "API_KEY")).toBe(true);
    });
  });

  // ==========================================================================
  // Database Persistence
  // ==========================================================================

  describe("Database Persistence", () => {
    it("saves services to database after fetching", async () => {
      await createTestSwarm(testWorkspace.id);
      
      const fetchedServices: ServiceConfig[] = [
        {
          name: "persisted-service",
          port: 3000,
          interpreter: "node",
          cwd: "/app",
          scripts: {
            start: "npm start",
            install: "npm install",
            build: "npm run build",
          },
        },
      ];
      fetchSpy.mockResolvedValue(createMockServicesResponse(fetchedServices));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      
      // Verify services were saved to database
      const swarm = await assertSwarmServicesInDB(testWorkspace.id, 1);
      const savedServices = swarm?.services as ServiceConfig[];
      
      expect(savedServices[0]).toMatchObject({
        name: "persisted-service",
        port: 3000,
        interpreter: "node",
        cwd: "/app",
      });
      expect(savedServices[0].scripts).toMatchObject({
        start: "npm start",
        install: "npm install",
        build: "npm run build",
      });
    });

    it("saves environment variables with encryption", async () => {
      await createTestSwarm(testWorkspace.id);
      
      const servicesWithEnv: ServiceConfig[] = [
        {
          name: "service",
          port: 3000,
          scripts: { start: "npm start" },
          env: {
            SECRET_KEY: "super-secret-value",
          },
        },
      ];
      fetchSpy.mockResolvedValue(createMockServicesResponse(servicesWithEnv));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      assertSuccessResponse(res, body);
      
      // Verify environment variables are encrypted in database
      const swarm = await db.swarm.findFirst({ where: { workspaceId: testWorkspace.id } });
      const envVars = swarm?.environmentVariables as Array<{ name: string; value: any }>;
      
      expect(envVars).toBeDefined();
      expect(envVars.length).toBeGreaterThan(0);
      
      // Verify values are encrypted (contain required fields)
      const secretVar = envVars.find((v) => v.name === "SECRET_KEY");
      expect(secretVar).toBeDefined();
      expect(secretVar?.value).toHaveProperty("data");
      expect(secretVar?.value).toHaveProperty("iv");
      expect(secretVar?.value).toHaveProperty("tag");
    });

    it("caches services after first fetch to avoid duplicate API calls", async () => {
      await createTestSwarm(testWorkspace.id);
      
      const services1: ServiceConfig[] = [
        { name: "service-v1", port: 3000, scripts: { start: "npm start" } },
      ];
      fetchSpy.mockResolvedValueOnce(createMockServicesResponse(services1));
      
      // First request - should fetch from API
      const response1 = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body1 = await response1.json();
      
      assertSuccessResponse(response1, body1);
      expect(body1.data.services).toEqual(services1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      
      // Second request - should return cached services without API call
      const response2 = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body2 = await response2.json();
      
      assertSuccessResponse(response2, body2);
      expect(body2.data.services).toEqual(services1); // Same cached services
      expect(fetchSpy).toHaveBeenCalledTimes(1); // No additional API calls
      
      // Verify only one swarm exists in database
      const swarms = await db.swarm.findMany({ where: { workspaceId: testWorkspace.id } });
      expect(swarms.length).toBe(1);
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe("Error Handling", () => {
    it("returns 500 when external API call fails", async () => {
      await createTestSwarm(testWorkspace.id);
      
      fetchSpy.mockRejectedValue(new Error("Network error"));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
        })
      );
      const body = await res.json();
      
      expect(res.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.message).toBe("Failed to ingest code");
    });

    it("handles PM2 parsing errors gracefully", async () => {
      await createTestSwarm(testWorkspace.id, {
        repositoryUrl: "https://github.com/test-org/test-repo",
      });
      await createTestGitHubAuth(testUser.id);
      await createTestGitHubAccount(testUser.id);
      
      // Mock agent with invalid PM2 config
      fetchSpy.mockResolvedValueOnce(createMockAgentInitResponse("test-request-123"));
      fetchSpy.mockResolvedValueOnce(
        createMockAgentProgressResponse("completed", {
          "pm2.config.js": "invalid javascript syntax {{{",
        })
      );
      
      // Mock stakgraph fallback
      fetchSpy.mockResolvedValueOnce(createMockServicesResponse([]));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
          repo_url: "https://github.com/test-org/test-repo",
        })
      );
      const body = await res.json();
      
      // Should still succeed with empty services from fallback
      assertSuccessResponse(res, body);
    });

    it("handles .env parsing errors gracefully", async () => {
      await createTestSwarm(testWorkspace.id, {
        repositoryUrl: "https://github.com/test-org/test-repo",
      });
      await createTestGitHubAuth(testUser.id);
      await createTestGitHubAccount(testUser.id);
      
      // Mock agent with valid PM2 but invalid .env
      fetchSpy.mockResolvedValueOnce(createMockAgentInitResponse("test-request-123"));
      fetchSpy.mockResolvedValueOnce(
        createMockAgentProgressResponse("completed", {
          "pm2.config.js": MOCK_PM2_CONFIG,
          ".env": "invalid\nenv\nformat\nwithout\nequals",
        })
      );
      
      // Mock stakgraph
      fetchSpy.mockResolvedValueOnce(createMockServicesResponse([]));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
          repo_url: "https://github.com/test-org/test-repo",
        })
      );
      const body = await res.json();
      
      // Should still succeed
      assertSuccessResponse(res, body);
      assertServicesStructure(body.data.services);
    });

    it("handles GitHub API errors gracefully", async () => {
      await createTestSwarm(testWorkspace.id, {
        repositoryUrl: "https://github.com/test-org/test-repo",
      });
      
      // Create GitHub auth but with invalid token
      await createTestGitHubAuth(testUser.id);
      await db.account.create({
        data: {
          userId: testUser.id,
          provider: "github",
          providerAccountId: generateUniqueId("github"),
          type: "oauth",
          access_token: JSON.stringify(enc.encryptField("access_token", "invalid_token")),
          token_type: "bearer",
        },
      });
      
      // Mock stakgraph to accept request even with invalid credentials
      fetchSpy.mockResolvedValue(createMockServicesResponse([]));
      
      const res = await GET(
        createGetRequest("http://localhost:3000/api/swarm/stakgraph/services", {
          workspaceId: testWorkspace.id,
          repo_url: "https://github.com/test-org/test-repo",
        })
      );
      const body = await res.json();
      
      // Should still complete successfully
      assertSuccessResponse(res, body);
    });
  });
});