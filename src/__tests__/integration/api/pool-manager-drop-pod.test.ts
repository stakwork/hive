import { describe, test, beforeEach, vi, expect, afterEach } from "vitest";
import { POST } from "@/app/api/pool-manager/drop-pod/[workspaceId]/route";
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
  createTestRepository,
} from "@/__tests__/support/fixtures";
import { EncryptionService } from "@/lib/encryption";
import { db } from "@/lib/db";
import type { User, Workspace, Swarm } from "@prisma/client";

// Mock environment config
vi.mock("@/lib/env", () => ({
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

// Mock getPodFromPool and updatePodRepositories from pods utilities
// Note: dropPod is NOT mocked - we want to test the actual implementation
vi.mock("@/lib/pods/utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pods/utils")>("@/lib/pods/utils");
  return {
    ...actual,
    getPodFromPool: vi.fn(),
    updatePodRepositories: vi.fn(),
  };
});

describe("POST /api/pool-manager/drop-pod/[workspaceId] - Integration Tests", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Create test scenario with workspace, owner, and swarm
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Drop Pod Owner" },
    });

    owner = scenario.owner;
    workspace = scenario.workspace;

    // Create swarm with encrypted API key
    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField("poolApiKey", "test-pool-api-key");

    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: "test-swarm",
      status: "ACTIVE",
    });

    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        poolName: "test-pool",
        poolApiKey: JSON.stringify(encryptedApiKey),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Ensure MOCK_BROWSER_URL is cleaned up after each test
    delete process.env.MOCK_BROWSER_URL;
  });

  describe("Authentication", () => {
    test("should return 401 when session is missing", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectUnauthorized(response);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 401 when user is missing from session", async () => {
      getMockedSession().mockResolvedValue({ user: null } as any);

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectUnauthorized(response);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 401 when user ID is missing from session", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date().toISOString(),
      } as any);

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Invalid user session", 401);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Workspace Validation", () => {
    test("should return 400 when workspaceId is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/drop-pod/?podId=test-pod-123"
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "" }),
      });

      await expectError(response, "Missing required field: workspaceId", 400);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 400 when podId query parameter is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Missing required field: podId", 400);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 404 when workspace does not exist", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/drop-pod/nonexistent-workspace?podId=test-pod-123"
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "nonexistent-workspace" }),
      });

      await expectNotFound(response, "Workspace not found");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 404 when workspace has no swarm", async () => {
      // Delete swarm
      await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectNotFound(response, "No swarm found for this workspace");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 400 when swarm missing poolName", async () => {
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolName: null },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Swarm not properly configured with pool information", 400);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 400 when swarm missing poolApiKey", async () => {
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolApiKey: null },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Swarm not properly configured with pool information", 400);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Authorization", () => {
    test("should return 403 when user is neither owner nor member", async () => {
      const nonMemberUser = await createTestUser({ name: "Non-member User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMemberUser));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectForbidden(response, "Access denied");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should allow workspace owner to drop pod", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock successful drop pod API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Pod dropped successfully",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);
    });

    test("should allow workspace member to drop pod", async () => {
      const memberUser = await createTestUser({ name: "Member User" });

      await db.workspaceMember.create({
        data: {
          userId: memberUser.id,
          workspaceId: workspace.id,
          role: "DEVELOPER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      // Mock successful drop pod API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Pod dropped successfully",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-456`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);
    });
  });

  describe("Successful Pod Dropping", () => {
    test("should successfully drop pod and return 200", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Pod dropped successfully",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-789`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod dropped successfully");
    });

    test("should call Pool Manager API with correct URL and parameters", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-abc-123`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://pool-manager.test.com/pools/test-pool/workspaces/pod-abc-123/mark-unused",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-api-key",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({}),
        })
      );
    });

    test("should drop pod without repository reset when latest=false", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { getPodFromPool, updatePodRepositories } = await import("@/lib/pods/utils");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123&latest=false`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should NOT call getPodFromPool or updatePodRepositories
      expect(getPodFromPool).not.toHaveBeenCalled();
      expect(updatePodRepositories).not.toHaveBeenCalled();
    });
  });

  describe("Repository Reset Logic", () => {
    test("should reset repositories when latest=true", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Create repository for workspace
      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
        branch: "main",
      });

      const { getPodFromPool, updatePodRepositories } = await import("@/lib/pods/utils");

      // Mock getPodFromPool to return pod details
      vi.mocked(getPodFromPool).mockResolvedValueOnce({
        id: "test-pod-123",
        password: "pod-password",
        portMappings: {
          "15552": "https://control.example.com",
        },
        url: "https://ide.example.com",
        state: "running",
      } as any);

      // Mock updatePodRepositories
      vi.mocked(updatePodRepositories).mockResolvedValueOnce(undefined);

      // Mock dropPod (mark-unused call)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123&latest=true`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Verify getPodFromPool was called
      expect(getPodFromPool).toHaveBeenCalledWith("test-pod-123", "decrypted-api-key");

      // Verify updatePodRepositories was called
      expect(updatePodRepositories).toHaveBeenCalledWith(
        "https://control.example.com",
        "pod-password",
        expect.arrayContaining([
          expect.objectContaining({ url: "https://github.com/test/repo" }),
        ])
      );
    });

    test("should skip repository reset when control port not found", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo2",
        branch: "develop",
      });

      const { getPodFromPool, updatePodRepositories } = await import("@/lib/pods/utils");

      // Mock getPodFromPool to return pod without control port
      vi.mocked(getPodFromPool).mockResolvedValueOnce({
        id: "test-pod-456",
        password: "pod-password",
        portMappings: {}, // No control port
        url: "https://ide.example.com",
        state: "running",
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-456&latest=true`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should call getPodFromPool but NOT updatePodRepositories
      expect(getPodFromPool).toHaveBeenCalled();
      expect(updatePodRepositories).not.toHaveBeenCalled();
    });

    test("should handle repository reset error gracefully", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo3",
        branch: "main",
      });

      const { getPodFromPool, updatePodRepositories } = await import("@/lib/pods/utils");

      vi.mocked(getPodFromPool).mockResolvedValueOnce({
        id: "test-pod-789",
        password: "pod-password",
        portMappings: {
          "15552": "https://control.example.com",
        },
        url: "https://ide.example.com",
        state: "running",
      } as any);

      // Mock updatePodRepositories to throw error
      vi.mocked(updatePodRepositories).mockRejectedValueOnce(
        new Error("Failed to update repositories: 500")
      );

      // Mock successful dropPod despite repository reset error
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-789&latest=true`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should still succeed in dropping pod despite repository reset failure
      await expectSuccess(response, 200);
    });

    test("should skip repository reset when no repositories exist", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { getPodFromPool, updatePodRepositories } = await import("@/lib/pods/utils");

      vi.mocked(getPodFromPool).mockResolvedValueOnce({
        id: "test-pod-101",
        password: "pod-password",
        portMappings: {
          "15552": "https://control.example.com",
        },
        url: "https://ide.example.com",
        state: "running",
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-101&latest=true`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should NOT call updatePodRepositories when no repositories exist
      expect(updatePodRepositories).not.toHaveBeenCalled();
    });
  });

  describe("Pool Manager API Integration", () => {
    test("should handle 404 error from Pool Manager", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Workspace not found in pool",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=nonexistent-pod`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to drop pod");
    });

    test("should handle 500 error from Pool Manager", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-error`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to drop pod", 500);
    });

    test("should handle network errors", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockRejectedValueOnce(new Error("Network request failed: ECONNREFUSED"));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-network`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to drop pod", 500);
    });

    test("should decrypt poolApiKey before making API call", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-decrypt`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Verify API was called with decrypted key
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-api-key",
          }),
        })
      );
    });

    test("should URL-encode pool name correctly", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolName: "test pool with spaces" },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-encode`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("pools/test%20pool%20with%20spaces"),
        expect.any(Object)
      );
    });
  });

  describe("Mock Environment Bypass", () => {
    test("should bypass pod dropping in mock mode", async () => {
      process.env.MOCK_BROWSER_URL = "https://mock.example.com";

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-mock`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod dropped successfully");

      // Verify no Pool Manager API call was made
      expect(mockFetch).not.toHaveBeenCalled();

      delete process.env.MOCK_BROWSER_URL;
    });
  });

  describe("Error Handling", () => {
    test("should handle getPodFromPool failure gracefully", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo",
        branch: "main",
      });

      const { getPodFromPool } = await import("@/lib/pods/utils");

      vi.mocked(getPodFromPool).mockRejectedValueOnce(
        new Error("Failed to get workspace from pool: 404")
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-fail&latest=true`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // getPodFromPool failure causes the entire request to fail
      // because it's not wrapped in try-catch in the route
      await expectError(response, "Failed to drop pod", 500);
    });

    test("should handle decryption errors gracefully", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const encService = EncryptionService.getInstance();
      vi.mocked(encService.decryptField).mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-decrypt-fail`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to drop pod");
    });
  });

  describe("No Local Database State Changes", () => {
    test("should not modify workspace or swarm state in database", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Capture initial state
      const initialWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
        include: { swarm: true },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-no-state`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Verify no database changes
      const finalWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
        include: { swarm: true },
      });

      expect(finalWorkspace).toEqual(initialWorkspace);
    });

    test("should only communicate with external Pool Manager", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const fetchSpy = vi.spyOn(global, "fetch");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-external`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Verify ONLY external API call
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("pool-manager.test.com"),
        expect.any(Object)
      );
    });
  });
});