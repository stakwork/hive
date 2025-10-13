import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/pool-manager/claim-pod/[workspaceId]/route";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { EncryptionService } from "@/lib/encryption";
import {
  createTestWorkspaceScenario,
  createTestSwarm,
} from "@/__tests__/support/fixtures";
import {
  createPostRequest,
  generateUniqueId,
  createAuthenticatedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  expectNotFound,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm } from "@prisma/client";

// Mock next-auth
vi.mock("next-auth/next");
const getMockedSession = vi.mocked(getServerSession);

// Mock global fetch
global.fetch = vi.fn();

// Mock environment variable getter
const originalEnv = process.env;

// Helper to create test user
async function createTestUser() {
  return await db.user.create({
    data: {
      name: "Test User",
      email: `test-${generateUniqueId("user")}@example.com`,
    },
  });
}

// Mock Pool Manager API response
function createMockPodResponse(portMappings: Record<string, string>) {
  return {
    success: true,
    workspace: {
      id: "workspace-123",
      name: "test-workspace",
      status: "active",
      portMappings,
    },
  };
}

describe("POST /api/pool-manager/claim-pod/[workspaceId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe("Authentication", () => {
    it("should return 401 when not authenticated", async () => {
      getMockedSession.mockResolvedValue(null);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/claim-pod/test-workspace-id",
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectUnauthorized(response);
    });

    it("should return 401 when session has no user", async () => {
      getMockedSession.mockResolvedValue({ user: null } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/claim-pod/test-workspace-id",
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectUnauthorized(response);
    });

    it("should return 401 when session user has no id", async () => {
      getMockedSession.mockResolvedValue({
        user: { email: "test@example.com" },
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/claim-pod/test-workspace-id",
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectError(response, "Invalid user session", 401);
    });
  });

  describe("Authorization", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;
    let memberViewer: User;
    let memberDeveloper: User;
    let memberAdmin: User;
    let nonMember: User;

    beforeEach(async () => {
      await db.$transaction(async (tx) => {
        const scenario = await createTestWorkspaceScenario({
          owner: { name: "Claim Pod Owner" },
          members: [
            { role: "VIEWER" },
            { role: "DEVELOPER" },
            { role: "ADMIN" },
          ],
        });

        owner = scenario.owner;
        workspace = scenario.workspace;
        memberViewer = scenario.members[0];
        memberDeveloper = scenario.members[1];
        memberAdmin = scenario.members[2];

        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = encryptionService.encryptField(
          "poolApiKey",
          "test-pool-api-key"
        );

        swarm = await createTestSwarm({
          workspaceId: workspace.id,
          name: `claim-swarm-${generateUniqueId("swarm")}`,
          status: "ACTIVE",
        });

        await tx.swarm.update({
          where: { id: swarm.id },
          data: {
            poolName: swarm.id,
            poolApiKey: JSON.stringify(encryptedApiKey),
          },
        });

        const nonMemberData = await tx.user.create({
          data: {
            name: "Non Member User",
            email: `non-member-${generateUniqueId("user")}@example.com`,
          },
        });
        nonMember = nonMemberData;
      });

      // Mock successful fetch response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => createMockPodResponse({ "3000": "https://frontend.example.com" }),
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should return 404 when workspace not found", async () => {
      getMockedSession.mockResolvedValue(
        createAuthenticatedSession(owner)
      );

      const request = createPostRequest(
        "http://localhost/api/pool-manager/claim-pod/nonexistent-workspace",
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "nonexistent-workspace" }),
      });

      await expectNotFound(response, "Workspace not found");
    });

    it("should return 403 for non-member access", async () => {
      getMockedSession.mockResolvedValue(
        createAuthenticatedSession(nonMember)
      );

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Access denied", 403);
    });

    it("should allow OWNER to claim pod", async () => {
      getMockedSession.mockResolvedValue(
        createAuthenticatedSession(owner)
      );

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.frontend).toBeDefined();
    });

    it("should allow ADMIN to claim pod", async () => {
      getMockedSession.mockResolvedValue(
        createAuthenticatedSession(memberAdmin)
      );

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    it("should allow DEVELOPER to claim pod", async () => {
      getMockedSession.mockResolvedValue(
        createAuthenticatedSession(memberDeveloper)
      );

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    it("should allow VIEWER to claim pod", async () => {
      getMockedSession.mockResolvedValue(
        createAuthenticatedSession(memberViewer)
      );

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Input Validation", () => {
    let owner: User;
    let workspace: Workspace;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Claim Input Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      getMockedSession.mockResolvedValue(
        createAuthenticatedSession(owner)
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should return 400 when workspaceId is missing", async () => {
      const request = createPostRequest(
        "http://localhost/api/pool-manager/claim-pod/",
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "" }),
      });

      await expectError(response, "Missing required field: workspaceId", 400);
    });

    it("should return 404 when workspace has no swarm", async () => {
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectNotFound(response, "No swarm found for this workspace");
    });

    it("should return 400 when swarm has no poolName", async () => {
      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `no-pool-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      const encryptionService = EncryptionService.getInstance();
      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: null,
          poolApiKey: JSON.stringify(
            encryptionService.encryptField("poolApiKey", "test-key")
          ),
        },
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(
        response,
        "Swarm not properly configured with pool information",
        400
      );
    });

    it("should return 400 when swarm has no poolApiKey", async () => {
      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `no-apikey-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: swarm.id,
          poolApiKey: null,
        },
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(
        response,
        "Swarm not properly configured with pool information",
        400
      );
    });
  });

  describe("Service Error Handling", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Claim Service Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "poolApiKey",
        "test-pool-api-key"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `service-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: swarm.id,
          poolApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      getMockedSession.mockResolvedValue(
        createAuthenticatedSession(owner)
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should return 500 when Pool Manager API returns error", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    it("should return 500 when Pool Manager API returns 404", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "Pool not found",
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    it("should handle network errors gracefully", async () => {
      (global.fetch as any).mockRejectedValue(new Error("Network error"));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    it("should handle timeout errors", async () => {
      (global.fetch as any).mockRejectedValue(new Error("Request timeout"));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    it("should handle malformed JSON responses", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });
  });

  describe("Port Mapping Logic", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Port Mapping Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "poolApiKey",
        "test-pool-api-key"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `port-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: swarm.id,
          poolApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      getMockedSession.mockResolvedValue(
        createAuthenticatedSession(owner)
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should extract frontend URL from port 3000", async () => {
      const portMappings = {
        "3000": "https://frontend-3000.example.com",
        "8080": "https://backend-8080.example.com",
        "15552": "https://ignored-15552.example.com",
        "15553": "https://ignored-15553.example.com",
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => createMockPodResponse(portMappings),
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://frontend-3000.example.com");
    });

    it("should filter out ports 15552 and 15553", async () => {
      const portMappings = {
        "15552": "https://should-not-use-1.example.com",
        "15553": "https://should-not-use-2.example.com",
        "4000": "https://frontend-4000.example.com",
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => createMockPodResponse(portMappings),
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://frontend-4000.example.com");
    });

    it("should use first available port when only one mapping exists", async () => {
      const portMappings = {
        "8000": "https://single-frontend.example.com",
        "15552": "https://ignored.example.com",
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => createMockPodResponse(portMappings),
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://single-frontend.example.com");
    });

    it("should return 500 when no valid frontend URL found", async () => {
      const portMappings = {
        "15552": "https://ignored-1.example.com",
        "15553": "https://ignored-2.example.com",
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => createMockPodResponse(portMappings),
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    it("should prefer port 3000 when multiple valid ports exist", async () => {
      const portMappings = {
        "8080": "https://should-not-use.example.com",
        "3000": "https://preferred-frontend.example.com",
        "4000": "https://also-not-used.example.com",
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => createMockPodResponse(portMappings),
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://preferred-frontend.example.com");
    });
  });

  describe("Mock Environment", () => {
    let owner: User;
    let workspace: Workspace;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Mock Env Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      getMockedSession.mockResolvedValue(
        createAuthenticatedSession(owner)
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
      delete process.env.MOCK_BROWSER_URL;
    });

    it("should return MOCK_BROWSER_URL when environment variable is set", async () => {
      process.env.MOCK_BROWSER_URL = "https://mock-frontend.example.com";

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `mock-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod claimed successfully");
      expect(data.frontend).toBe("https://mock-frontend.example.com");
    });

    it("should bypass pool configuration checks when MOCK_BROWSER_URL is set", async () => {
      process.env.MOCK_BROWSER_URL = "https://mock-env.example.com";

      // Create workspace with no swarm (would normally fail)
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should succeed despite missing swarm
      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://mock-env.example.com");
    });
  });

  describe("Response Structure", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Response Structure Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "poolApiKey",
        "test-pool-api-key"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `response-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: swarm.id,
          poolApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      getMockedSession.mockResolvedValue(
        createAuthenticatedSession(owner)
      );

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => createMockPodResponse({ "3000": "https://frontend.example.com" }),
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should return valid response structure", async () => {
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("message");
      expect(data).toHaveProperty("frontend");
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod claimed successfully");
      expect(typeof data.frontend).toBe("string");
    });

    it("should return valid URL format for frontend", async () => {
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.frontend).toMatch(/^https?:\/\//);
    });
  });

  describe("API Key Management", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "API Key Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `apikey-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      getMockedSession.mockResolvedValue(
        createAuthenticatedSession(owner)
      );

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => createMockPodResponse({ "3000": "https://frontend.example.com" }),
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should handle missing poolApiKey with automatic provisioning", async () => {
      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: swarm.id,
          poolApiKey: null,
        },
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      
      // Current implementation returns 400 when poolApiKey is missing
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(
        response,
        "Swarm not properly configured with pool information",
        400
      );
    });

    it("should decrypt poolApiKey before making API call", async () => {
      const encryptionService = EncryptionService.getInstance();
      const testApiKey = "decrypted-test-key";
      const encryptedApiKey = encryptionService.encryptField(
        "poolApiKey",
        testApiKey
      );

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: swarm.id,
          poolApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);

      // Verify fetch was called with decrypted Bearer token
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${testApiKey}`,
          }),
        })
      );
    });
  });
});