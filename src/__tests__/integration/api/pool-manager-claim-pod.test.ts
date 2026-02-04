import { describe, test, beforeEach, vi, expect } from "vitest";
import { POST } from "@/app/api/pool-manager/claim-pod/[workspaceId]/route";
import {
  createAuthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectNotFound,
  expectForbidden,
  createPostRequest,
} from "@/__tests__/support/helpers";
import {
  createTestUser,
  createTestWorkspaceScenario,
  createTestSwarm,
} from "@/__tests__/support/fixtures";
import { EncryptionService } from "@/lib/encryption";
import { db } from "@/lib/db";

// Mock environment config
vi.mock("@/config/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://pool-manager.test.com",
  },
}));

// Mock EncryptionService
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((fieldName: string, encryptedValue: string) => "decrypted-api-key"),
      encryptField: vi.fn((fieldName: string, plainValue: string) => ({
        data: "encrypted-data",
        iv: "initialization-vector",
        tag: "auth-tag",
        keyId: "default",
        version: "1",
        encryptedAt: new Date().toISOString(),
      })),
    })),
  },
}));

// Mock swarm secrets management
vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn(),
  updateSwarmPoolApiKeyFor: vi.fn(),
}));

describe("POST /api/pool-manager/claim-pod/[workspaceId] - Integration Tests", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  // Helper to setup successful pod claim mocks
  const setupSuccessfulPodClaimMocks = (
    portMappings: Record<string, string> = { "3000": "https://frontend.example.com" },
    frontendPort: string = "3000"
  ) => {
    mockFetch
      // First call: GET workspace from pool
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            id: "workspace-123",
            password: "test-password",
            url: "https://ide.example.com",
            portMappings: {
              ...portMappings,
              "15552": "https://control.example.com",
            },
          },
        }),
        text: async () => JSON.stringify({ success: true }),
      })
      // Second call: POST mark-used
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
      })
      // Third call: GET /jlist (process list)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([
          { pid: 123, name: "frontend", status: "online", port: frontendPort },
        ]),
        text: async () => JSON.stringify([{ pid: 123, name: "frontend", status: "online", port: frontendPort }]),
      });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  describe("Authentication", () => {
    test("returns 401 when session is missing", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/claim-pod/test-workspace-id"
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectUnauthorized(response);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 401 when user is missing from session", async () => {
      getMockedSession().mockResolvedValue({ user: null } as any);

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/claim-pod/test-workspace-id"
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectUnauthorized(response);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 401 when user ID is missing from session", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date().toISOString(),
      } as any);

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/claim-pod/test-workspace-id"
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectError(response, "Invalid user session", 401);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Workspace Validation", () => {
    test("returns 400 when workspaceId is missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/claim-pod/"
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "" }),
      });

      await expectError(response, "Missing required field: workspaceId", 400);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 404 when workspace does not exist", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/claim-pod/nonexistent-workspace-id"
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "nonexistent-workspace-id" }),
      });

      await expectNotFound(response, "Workspace not found");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 404 when workspace has no swarm", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        workspace: { name: "No Swarm Workspace" },
      });

      // Delete swarm if it exists
      await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectNotFound(response, "No swarm found for this workspace");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 400 when swarm missing poolApiKey", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      // Set poolName but leave poolApiKey null
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolName: "test-pool", poolApiKey: null },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Swarm not properly configured with pool information", 400);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Authorization", () => {
    test("returns 403 when user is neither owner nor member", async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const nonMemberUser = await createTestUser({ name: "Non-member User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMemberUser));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectForbidden(response, "Access denied");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("allows workspace owner to claim pod", async () => {
      const { owner, workspace, swarm, pods } = await createTestWorkspaceScenario({
        withSwarm: true,
        withPods: true,
        podCount: 1,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);
      const data = await response.json();
      expect(data.podId).toBe(pods[0].id);
    });

    test("allows workspace member to claim pod", async () => {
      const { workspace, members, pods } = await createTestWorkspaceScenario({
        members: [{ role: "DEVELOPER" }],
        withSwarm: true,
        withPods: true,
        podCount: 1,
      });

      const memberUser = members[0];

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);
      const data = await response.json();
      expect(data.podId).toBe(pods[0].id);
    });
  });


});
