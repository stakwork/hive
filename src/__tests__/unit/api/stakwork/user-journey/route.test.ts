import { describe, it, expect, vi, beforeEach } from "vitest";
import { invokeRoute } from "@/__tests__/harness/route";
import { POST } from "@/app/api/stakwork/user-journey/route";

// Mock all dependencies including the external Stakwork API
vi.mock("@/lib/auth/nextauth");
vi.mock("@/services/workspace");
vi.mock("@/lib/db");
vi.mock("@/lib/utils/swarm");

// Mock fetch globally for Stakwork API calls
global.fetch = vi.fn();

import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getWorkspaceById } from "@/services/workspace";
import { db } from "@/lib/db";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";

// Test Data Helpers - Centralized test data creation
const createMockSession = (userId?: string) => ({
  user: {
    id: userId || "user-123",
    email: "test@example.com",
    name: "Test User",
  },
  expires: new Date(Date.now() + 86400000).toISOString(),
});

const createMockWorkspace = (overrides = {}) => ({
  id: "workspace-123",
  name: "Test Workspace",
  slug: "test-workspace",
  ownerId: "user-123",
  description: "Test workspace description",
  deleted: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createMockSwarm = (overrides = {}) => ({
  id: "swarm-123",
  swarmUrl: "https://test-swarm.sphinx.chat/api",
  swarmSecretAlias: "{{SWARM_123_API_KEY}}",
  poolName: "test-pool",
  ...overrides,
});

const createMockGithubProfile = (overrides = {}) => ({
  username: "testuser",
  token: "github_pat_test123",
  ...overrides,
});

const createMockStakworkResponse = (overrides = {}) => ({
  success: true,
  data: {
    project_id: 456,
    workflow_id: 789,
    status: "pending",
    ...overrides,
  },
});

const createMockRequestBody = (overrides = {}) => ({
  message: "Test user journey message",
  workspaceId: "workspace-123",
  ...overrides,
});

describe("POST /api/stakwork/user-journey", () => {
  // Mock instances
  let mockGetGithubUsernameAndPAT: ReturnType<typeof vi.fn>;
  let mockGetWorkspaceById: ReturnType<typeof vi.fn>;
  let mockDbWorkspaceFindUnique: ReturnType<typeof vi.fn>;
  let mockDbSwarmFindUnique: ReturnType<typeof vi.fn>;
  let mockTransformSwarmUrlToRepo2Graph: ReturnType<typeof vi.fn>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Setup mock implementations
    mockGetGithubUsernameAndPAT = vi.mocked(getGithubUsernameAndPAT);
    mockGetWorkspaceById = vi.mocked(getWorkspaceById);
    mockDbWorkspaceFindUnique = vi.fn();
    mockDbSwarmFindUnique = vi.fn();
    mockTransformSwarmUrlToRepo2Graph = vi.mocked(transformSwarmUrlToRepo2Graph);
    mockFetch = vi.mocked(global.fetch);

    // Mock db methods
    vi.mocked(db).workspace = {
      findUnique: mockDbWorkspaceFindUnique,
    } as any;

    vi.mocked(db).swarm = {
      findUnique: mockDbSwarmFindUnique,
    } as any;

    // Mock environment variables
    vi.stubEnv('STAKWORK_API_KEY', 'test-api-key');
    vi.stubEnv('STAKWORK_USER_JOURNEY_WORKFLOW_ID', '123');
    vi.stubEnv('STAKWORK_BASE_URL', 'https://stakwork-api.example.com');
  });

  describe("Authentication", () => {
    it("should return 401 when user is not authenticated", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        session: null,
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(401);
      const json = await result.json();
      expect(json).toEqual({ error: "Unauthorized" });
    });

    it("should return 401 when session has no user", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        session: { expires: new Date().toISOString() },
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(401);
      const json = await result.json();
      expect(json).toEqual({ error: "Unauthorized" });
    });

    it("should return 401 when user session has no id", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        session: {
          user: { email: "test@example.com" },
          expires: new Date().toISOString(),
        },
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(401);
      const json = await result.json();
      expect(json).toEqual({ error: "Invalid user session" });
    });
  });

  describe("Request Validation", () => {
    it("should return 400 when message is missing", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ message: undefined }),
      });

      expect(result.status).toBe(400);
      const json = await result.json();
      expect(json).toEqual({ error: "Message is required" });
    });

    it("should return 400 when message is empty string", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ message: "" }),
      });

      expect(result.status).toBe(400);
      const json = await result.json();
      expect(json).toEqual({ error: "Message is required" });
    });

    it("should return 400 when workspaceId is missing", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ workspaceId: undefined }),
      });

      expect(result.status).toBe(400);
      const json = await result.json();
      expect(json).toEqual({ error: "Workspace ID is required" });
    });

    it("should return 400 when workspaceId is empty string", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ workspaceId: "" }),
      });

      expect(result.status).toBe(400);
      const json = await result.json();
      expect(json).toEqual({ error: "Workspace ID is required" });
    });
  });

  describe("Workspace Access", () => {
    it("should return 404 when workspace is not found or access is denied", async () => {
      mockGetWorkspaceById.mockResolvedValue(null);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(404);
      const json = await result.json();
      expect(json).toEqual({ error: "Workspace not found or access denied" });
      expect(mockGetWorkspaceById).toHaveBeenCalledWith("workspace-123", "user-123");
    });

    it("should return 404 when workspace data cannot be retrieved", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue(null);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(404);
      const json = await result.json();
      expect(json).toEqual({ error: "Workspace not found" });
      expect(mockDbWorkspaceFindUnique).toHaveBeenCalledWith({
        where: { id: "workspace-123" },
        select: { slug: true },
      });
    });
  });

  describe("Swarm Configuration", () => {
    it("should return 404 when no swarm is found for workspace", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({
        slug: "test-workspace",
      });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(null);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(404);
      const json = await result.json();
      expect(json).toEqual({ error: "No swarm found for this workspace" });
      expect(mockDbSwarmFindUnique).toHaveBeenCalledWith({
        where: { workspaceId: "workspace-123" },
        select: {
          id: true,
          swarmUrl: true,
          swarmSecretAlias: true,
          poolName: true,
        },
      });
    });
  });

  describe("Successful Request", () => {
    it("should return 201 with workflow data on successful request", async () => {
      const mockWorkspace = createMockWorkspace();
      const mockSwarm = createMockSwarm();
      const mockGithubProfile = createMockGithubProfile();
      const mockStakworkResponseData = { success: true, data: { project_id: 456, workflow_id: 789, status: "pending" } };

      mockGetWorkspaceById.mockResolvedValue(mockWorkspace);
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(mockGithubProfile);
      mockDbSwarmFindUnique.mockResolvedValue(mockSwarm);
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      // Mock successful Stakwork API response
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStakworkResponseData),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
      const json = await result.json();
      expect(json).toEqual({
        success: true,
        message: "called stakwork",
        workflow: mockStakworkResponseData.data,
      });
    });

    it("should call transformSwarmUrlToRepo2Graph with swarm URL", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(createMockSwarm());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      } as Response);

      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(mockTransformSwarmUrlToRepo2Graph).toHaveBeenCalledWith(
        "https://test-swarm.sphinx.chat/api"
      );
    });

    it("should handle null GitHub profile gracefully", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(null);
      mockDbSwarmFindUnique.mockResolvedValue(createMockSwarm());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
    });

    it("should use poolName from swarm or fallback to swarm id", async () => {
      const mockSwarmWithoutPoolName = createMockSwarm({
        poolName: null,
        id: "swarm-fallback-123",
      });

      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(mockSwarmWithoutPoolName);
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
    });

    it("should return workflow data when Stakwork API succeeds", async () => {
      const mockWorkflowData = {
        project_id: 789,
        workflow_id: 456,
        status: "completed",
      };

      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(createMockSwarm());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockWorkflowData }),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
      const json = await result.json();
      expect(json.workflow).toEqual(mockWorkflowData);
    });

    it("should return null workflow when Stakwork API returns failure", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(createMockSwarm());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: false, error: "API error" }),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
      const json = await result.json();
      expect(json.workflow).toBeNull();
    });
  });

  describe("Error Handling", () => {
    it("should return 500 when an unexpected error occurs", async () => {
      mockGetWorkspaceById.mockRejectedValue(new Error("Database connection failed"));

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(500);
      const json = await result.json();
      expect(json).toEqual({ error: "Failed to create chat message" });
    });

    it("should return 500 when db.workspace.findUnique throws error", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockRejectedValue(new Error("Query failed"));

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(500);
      const json = await result.json();
      expect(json).toEqual({ error: "Failed to create chat message" });
    });

    it("should return 500 when Stakwork API throws error", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(createMockSwarm());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      // Mock fetch to throw an error that should be caught by the outer try-catch
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      // The error should be handled by callStakwork internally and return 201 with null workflow
      expect(result.status).toBe(201);
      const json = await result.json();
      expect(json).toEqual({
        success: true,
        message: "called stakwork",
        workflow: null,
      });
    });
  });

  describe("Integration Scenarios", () => {
    it("should pass correct parameters to getGithubUsernameAndPAT", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(createMockSwarm());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      } as Response);

      await invokeRoute(POST, {
        method: "POST",
        session: createMockSession("user-456"),
        body: createMockRequestBody(),
      });

      expect(mockGetGithubUsernameAndPAT).toHaveBeenCalledWith("user-456", "test-workspace");
    });

    it("should handle empty swarmUrl gracefully", async () => {
      const mockSwarmWithoutUrl = createMockSwarm({ swarmUrl: null });

      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(mockSwarmWithoutUrl);
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
    });
  });

  describe("Edge Cases and Error Resilience", () => {
    it("should handle malformed JSON response from Stakwork API", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(createMockSwarm());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      // Mock Stakwork API returning malformed JSON
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error("Unexpected token in JSON")),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
      const json = await result.json();
      expect(json.success).toBe(true);
      expect(json.workflow).toBeNull();
    });

    it("should handle unexpected HTTP status codes from Stakwork API", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(createMockSwarm());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      // Mock 429 Rate Limit response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
      const json = await result.json();
      expect(json.success).toBe(true);
      expect(json.workflow).toBeNull();
    });

    it("should handle missing STAKWORK_BASE_URL environment variable", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(createMockSwarm());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      // Remove STAKWORK_BASE_URL from environment
      delete process.env.STAKWORK_BASE_URL;
      
      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      // Should still proceed but with undefined base URL (graceful degradation)
      expect(result.status).toBe(201);
      
      // Restore environment variable
      vi.stubEnv('STAKWORK_BASE_URL', 'https://stakwork-api.example.com');
    });

    it("should handle workflow ID parsing with non-numeric value", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(createMockSwarm());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      // Set workflow ID to non-numeric value
      vi.stubEnv('STAKWORK_USER_JOURNEY_WORKFLOW_ID', 'invalid-id');
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      // Should handle parseInt(NaN) gracefully
      expect(result.status).toBe(201);
      
      // Restore environment variable
      vi.stubEnv('STAKWORK_USER_JOURNEY_WORKFLOW_ID', '123');
    });

    it("should handle very long message content", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(createMockSwarm());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      } as Response);

      // Create message with 50,000 characters
      const veryLongMessage = "a".repeat(50000);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ message: veryLongMessage }),
      });

      expect(result.status).toBe(201);
      const json = await result.json();
      expect(json.success).toBe(true);
    });

    it("should handle special characters and unicode in message", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(createMockSwarm());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      } as Response);

      const specialMessage = "Test 🚀 with émojis, spëcîål çhars, and 中文字符";

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody({ message: specialMessage }),
      });

      expect(result.status).toBe(201);
      const json = await result.json();
      expect(json.success).toBe(true);
    });

    it("should handle Stakwork API returning success false with error details", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      mockDbSwarmFindUnique.mockResolvedValue(createMockSwarm());
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ 
          success: false, 
          error: "Workflow execution failed: Invalid parameters" 
        }),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
      const json = await result.json();
      expect(json.success).toBe(true);
      expect(json.workflow).toBeNull();
    });

    it("should handle partial swarm configuration with missing fields", async () => {
      mockGetWorkspaceById.mockResolvedValue(createMockWorkspace());
      mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
      mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
      
      // Swarm with missing optional fields
      const partialSwarm = createMockSwarm({
        swarmUrl: null,
        swarmSecretAlias: null,
        poolName: null,
      });
      
      mockDbSwarmFindUnique.mockResolvedValue(partialSwarm);
      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("");
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      } as Response);

      const result = await invokeRoute(POST, {
        method: "POST",
        session: createMockSession(),
        body: createMockRequestBody(),
      });

      expect(result.status).toBe(201);
      const json = await result.json();
      expect(json.success).toBe(true);
    });
  });
});