import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/stakwork/user-journey/route";
import { NextRequest } from "next/server";
import { 
  createMockSession, 
  createMockWorkspace, 
  createMockWorkspaceData, 
  createMockSwarm, 
  createMockGithubProfile 
} from "@/__tests__/support/fixtures/stakwork";
import { setupStakworkSuccessfulMocks, createStakworkTestRequest } from "@/__tests__/support/helpers/stakwork";

// Mock external modules with factory functions to avoid hoisting issues
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  getWorkspaceById: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
    },
    swarm: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_USER_JOURNEY_WORKFLOW_ID: "123",
    STAKWORK_BASE_URL: "https://stakwork.example.com",
  },
}));

// Mock transformSwarmUrlToRepo2Graph utility
vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: (url: string) => 
    url ? url.replace("/api", ":7799") : "",
}));

// Mock global fetch for Stakwork API calls
global.fetch = vi.fn();

describe("POST /api/stakwork/user-journey", () => {
  // Shared test data builders
  const TEST_USER_ID = "user-123";
  const TEST_WORKSPACE_ID = "workspace-456";
  const TEST_MESSAGE = "Create a login feature";
  const TEST_SLUG = "test-workspace";

  const createMockSession = (userId?: string) => ({
    user: userId ? { id: userId } : {},
  });

  const createMockWorkspace = (overrides = {}) => ({
    id: TEST_WORKSPACE_ID,
    name: "Test Workspace",
    slug: TEST_SLUG,
    ownerId: TEST_USER_ID,
    ...overrides,
  });

  const createMockWorkspaceData = (overrides = {}) => ({
    id: TEST_WORKSPACE_ID,
    slug: TEST_SLUG,
    ...overrides,
  });

  const createMockSwarm = (overrides = {}) => ({
    id: "swarm-789",
    swarmUrl: "https://test-swarm.sphinx.chat/api",
    swarmSecretAlias: "SWARM_SECRET",
    poolName: "test-pool",
    ...overrides,
  });

  const createMockGithubProfile = (overrides = {}) => ({
    username: "testuser",
    token: "github-token-123",
    ...overrides,
  });

  const createTestRequest = (body: Record<string, unknown>) => {
    return new NextRequest("http://localhost:3000/api/stakwork/user-journey", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  };

  const setupSuccessfulMocks = async () => {
    const { getServerSession } = await import("next-auth/next");
    const { getWorkspaceById } = await import("@/services/workspace");
    const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
    const { db } = await import("@/lib/db");

    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEST_USER_ID));
    vi.mocked(getWorkspaceById).mockResolvedValue(createMockWorkspace());
    vi.mocked(db.workspace.findUnique).mockResolvedValue(createMockWorkspaceData());
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(createMockGithubProfile());
    vi.mocked(db.swarm.findUnique).mockResolvedValue(createMockSwarm());
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: "workflow-123", status: "created" },
      }),
    } as Response);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("returns 401 when session is missing", async () => {
      const { getServerSession } = await import("next-auth/next");
      vi.mocked(getServerSession).mockResolvedValue(null);

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when user is not in session", async () => {
      const { getServerSession } = await import("next-auth/next");
      vi.mocked(getServerSession).mockResolvedValue({ user: null });

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when userId is missing from session", async () => {
      const { getServerSession } = await import("next-auth/next");
      vi.mocked(getServerSession).mockResolvedValue({
        user: { email: "test@example.com" },
      });

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Input Validation", () => {
    beforeEach(async () => {
      const { getServerSession } = await import("next-auth/next");
      vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEST_USER_ID));
    });

    it("returns 400 when message is missing", async () => {
      const request = createTestRequest({
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Message is required");
    });

    it("returns 400 when message is empty string", async () => {
      const request = createTestRequest({
        message: "",
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Message is required");
    });

    it("returns 400 when workspaceId is missing", async () => {
      const request = createTestRequest({
        message: TEST_MESSAGE,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Workspace ID is required");
    });

    it("returns 400 when workspaceId is empty string", async () => {
      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: "",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Workspace ID is required");
    });
  });

  describe("Workspace Access", () => {
    beforeEach(async () => {
      const { getServerSession } = await import("next-auth/next");
      vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEST_USER_ID));
    });

    it("returns 404 when workspace is not found", async () => {
      const { getWorkspaceById } = await import("@/services/workspace");
      vi.mocked(getWorkspaceById).mockResolvedValue(null);

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
      expect(getWorkspaceById).toHaveBeenCalledWith(TEST_WORKSPACE_ID, TEST_USER_ID);
    });

    it("returns 404 when user has no access to workspace", async () => {
      const { getWorkspaceById } = await import("@/services/workspace");
      vi.mocked(getWorkspaceById).mockResolvedValue(null);

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
    });

    it("returns 404 when workspace slug lookup fails", async () => {
      const { getWorkspaceById } = await import("@/services/workspace");
      const { db } = await import("@/lib/db");
      
      vi.mocked(getWorkspaceById).mockResolvedValue(createMockWorkspace());
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found");
      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { id: TEST_WORKSPACE_ID },
        select: { slug: true },
      });
    });
  });

  describe("Swarm Validation", () => {
    beforeEach(async () => {
      const { getServerSession } = await import("next-auth/next");
      const { getWorkspaceById } = await import("@/services/workspace");
      const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
      const { db } = await import("@/lib/db");

      vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEST_USER_ID));
      vi.mocked(getWorkspaceById).mockResolvedValue(createMockWorkspace());
      vi.mocked(db.workspace.findUnique).mockResolvedValue(createMockWorkspaceData());
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(createMockGithubProfile());
    });

    it("returns 404 when swarm is not found", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.swarm.findUnique).mockResolvedValue(null);

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("No swarm found for this workspace");
      expect(db.swarm.findUnique).toHaveBeenCalledWith({
        where: { workspaceId: TEST_WORKSPACE_ID },
        select: {
          id: true,
          swarmUrl: true,
          swarmSecretAlias: true,
          poolName: true,
        },
      });
    });
  });

  describe("Successful Workflow Creation", () => {
    beforeEach(async () => {
      await setupSuccessfulMocks();
    });

    it("creates workflow successfully with all required data", async () => {
      const mockWorkflowData = {
        id: "workflow-123",
        status: "created",
        name: "test-workflow",
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: mockWorkflowData,
        }),
      } as Response);

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBe("called stakwork");
      expect(data.workflow).toEqual(mockWorkflowData);
    });

    it("calls getGithubUsernameAndPAT with correct parameters", async () => {
      const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
      
      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      await POST(request);

      expect(getGithubUsernameAndPAT).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_SLUG
      );
    });

    it("calls Stakwork API with correct endpoint", async () => {
      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      await POST(request);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://stakwork.example.com/projects",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Token token=test-api-key",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("sends correct workflow payload to Stakwork API", async () => {
      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      await POST(request);

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload).toMatchObject({
        name: "hive_autogen",
        workflow_id: 123,
        workflow_params: {
          set_var: {
            attributes: {
              vars: {
                message: TEST_MESSAGE,
                accessToken: "github-token-123",
                username: "testuser",
                swarmUrl: "https://test-swarm.sphinx.chat:8444/api",
                swarmSecretAlias: "SWARM_SECRET",
                poolName: "test-pool",
              },
            },
          },
        },
      });
    });

    it("transforms swarmUrl by replacing /api with :8444/api", async () => {
      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      await POST(request);

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload.workflow_params.set_var.attributes.vars.swarmUrl).toBe(
        "https://test-swarm.sphinx.chat:8444/api"
      );
    });

    it("handles swarmUrl with custom domain correctly", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.swarm.findUnique).mockResolvedValue(
        createMockSwarm({ swarmUrl: "https://custom-swarm.example.com/api" })
      );

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      await POST(request);

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload.workflow_params.set_var.attributes.vars.swarmUrl).toBe(
        "https://custom-swarm.example.com:8444/api"
      );
    });

    it("handles null GitHub credentials gracefully", async () => {
      const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload.workflow_params.set_var.attributes.vars.accessToken).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.username).toBeNull();
    });

    it("handles swarm with null swarmSecretAlias", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.swarm.findUnique).mockResolvedValue(
        createMockSwarm({ swarmSecretAlias: null })
      );

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload.workflow_params.set_var.attributes.vars.swarmSecretAlias).toBeNull();
    });

    it("uses swarm id as poolName when poolName is null", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.swarm.findUnique).mockResolvedValue(
        createMockSwarm({ poolName: null, id: "swarm-999" })
      );

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      await POST(request);

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload.workflow_params.set_var.attributes.vars.poolName).toBe("swarm-999");
    });

    it("includes repo2GraphUrl in workflow payload", async () => {
      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      await POST(request);

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload.workflow_params.set_var.attributes.vars).toHaveProperty("repo2graph_url");
      expect(payload.workflow_params.set_var.attributes.vars.repo2graph_url).toBe(
        "https://test-swarm.sphinx.chat:7799"
      );
    });
  });

  describe("Error Handling", () => {
    beforeEach(async () => {
      await setupSuccessfulMocks();
    });

    it("handles Stakwork API failure gracefully", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow).toBeNull();
    });

    it("handles network errors during Stakwork API call", async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"));

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow).toBeNull();
    });

    it("returns 500 when database query fails", async () => {
      const { getWorkspaceById } = await import("@/services/workspace");
      vi.mocked(getWorkspaceById).mockRejectedValue(new Error("Database connection error"));

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create chat message");
    });

    it("returns 500 when unexpected error occurs", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.swarm.findUnique).mockRejectedValue(new Error("Unexpected error"));

      const request = createTestRequest({
        message: TEST_MESSAGE,
        workspaceId: TEST_WORKSPACE_ID,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create chat message");
    });

    it("handles JSON parsing errors in request body", async () => {
      const request = new NextRequest("http://localhost:3000/api/stakwork/user-journey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "invalid-json",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create chat message");
    });
  });
});
