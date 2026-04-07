import { describe, test, beforeEach, vi, expect } from "vitest";
import { POST } from "@/app/api/pool-manager/claim-pod/[workspaceId]/route";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectNotFound,
  expectForbidden,
  createPostRequest,
} from "@/__tests__/support/helpers";
import {
  createRequestWithHeaders,
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers/request-builders";
import {
  createTestUser,
  createTestWorkspaceScenario,
  createTestSwarm,
  createTestTask,
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

const VALID_API_TOKEN = "test-api-token-secret";

describe("POST /api/pool-manager/claim-pod/[workspaceId] - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set the API_TOKEN env var for tests
    process.env.API_TOKEN = VALID_API_TOKEN;
  });

  describe("Authentication", () => {
    test("returns 401 when no auth headers and no api token", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/claim-pod/test-workspace-id",
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectUnauthorized(response);
    });

    test("returns 401 when x-api-token is invalid and no session", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/pool-manager/claim-pod/test-workspace-id",
        "POST",
        { "x-api-token": "wrong-token" },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectUnauthorized(response);
    });

    test("returns 401 when auth status header is missing", async () => {
      // Request without any middleware auth headers → unauthenticated
      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/claim-pod/test-workspace-id",
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectUnauthorized(response);
    });
  });

  describe("Workspace Validation", () => {
    test("returns 400 when workspaceId is missing", async () => {
      // workspaceId check happens before auth, so no auth headers needed
      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/claim-pod/",
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "" }),
      });

      await expectError(response, "Missing required field: workspaceId", 400);
    });

    test("returns 404 when workspace does not exist", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/pool-manager/claim-pod/nonexistent-workspace-id",
        user,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "nonexistent-workspace-id" }),
      });

      await expectNotFound(response, "Workspace not found");
    });

    test("returns 404 when workspace has no swarm", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        workspace: { name: "No Swarm Workspace" },
      });

      // Delete swarm if it exists
      await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        owner,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectNotFound(response, "No swarm found for this workspace");
    });

    test("returns 500 when no pods available to claim", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      // Don't create any pods, so claiming will fail
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        owner,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should return 503 when no pods are available
      expect(response.status).toBe(503);
    });
  });

  describe("Authorization — session auth", () => {
    test("returns 403 when user is neither owner nor member", async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const nonMemberUser = await createTestUser({ name: "Non-member User" });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        nonMemberUser,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectForbidden(response, "Access denied");
    });

    test("allows workspace owner to claim pod", async () => {
      const { owner, workspace, pods } = await createTestWorkspaceScenario({
        withSwarm: true,
        withPods: true,
        podCount: 1,
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        owner,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.podId).toBe(pods[0].podId);
      expect(data).toHaveProperty("password");
    });

    test("allows workspace member to claim pod", async () => {
      const { workspace, members, pods } = await createTestWorkspaceScenario({
        members: [{ role: "DEVELOPER" }],
        withSwarm: true,
        withPods: true,
        podCount: 1,
      });

      const memberUser = members[0];

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        memberUser,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.podId).toBe(pods[0].podId);
      expect(data).toHaveProperty("password");
    });
  });

  describe("Authorization — x-api-token auth", () => {
    test("valid x-api-token bypasses ownership check and claims pod", async () => {
      const { workspace, pods } = await createTestWorkspaceScenario({
        withSwarm: true,
        withPods: true,
        podCount: 1,
      });

      const request = createRequestWithHeaders(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        "POST",
        { "x-api-token": VALID_API_TOKEN },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.podId).toBe(pods[0].podId);
      expect(data).toHaveProperty("pod_url");
      expect(data).toHaveProperty("frontend");
      expect(data).toHaveProperty("control");
      expect(data).toHaveProperty("ide");
      expect(data).toHaveProperty("password");
    });

    test("valid x-api-token succeeds for a non-member user workspace (ownership check skipped)", async () => {
      // Create workspace owned by someone else — would normally 403 with session auth
      const { workspace, pods } = await createTestWorkspaceScenario({
        withSwarm: true,
        withPods: true,
        podCount: 1,
      });

      const request = createRequestWithHeaders(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        "POST",
        { "x-api-token": VALID_API_TOKEN },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should succeed — API token callers are trusted system actors
      const data = await expectSuccess(response, 200);
      expect(data.podId).toBe(pods[0].podId);
      expect(data).toHaveProperty("password");
    });

    test("returns 401 when x-api-token is missing and no session", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/pool-manager/claim-pod/test-workspace-id",
        "POST",
        {},
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectUnauthorized(response);
    });

    test("returns 401 when x-api-token value is incorrect and no session", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/pool-manager/claim-pod/test-workspace-id",
        "POST",
        { "x-api-token": "invalid-token" },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectUnauthorized(response);
    });
  });

  describe("Task pod guard", () => {
    test("returns 409 when task already has a pod assigned", async () => {
      const { owner, workspace, pods } = await createTestWorkspaceScenario({
        withSwarm: true,
        withPods: true,
        podCount: 1,
      });

      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: owner.id,
      });

      // Simulate task already having a pod assigned
      await db.task.update({
        where: { id: task.id },
        data: { podId: pods[0].podId },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}?taskId=${task.id}`,
        owner,
        {},
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Task already has a pod assigned", 409);
    });
  });
});
