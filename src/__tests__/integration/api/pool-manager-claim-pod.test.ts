import { describe, test, beforeEach, afterEach, vi, expect } from "vitest";
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

// Mock process list returned by getProcessList (called against pod control port)
const MOCK_PROCESS_LIST = [
  { pid: 1, name: "frontend", status: "online", port: "3000", pm_uptime: 1000, cwd: "/workspace" },
  { pid: 2, name: "goose", status: "online", port: "15551", pm_uptime: 1000, cwd: "/workspace" },
];

describe("POST /api/pool-manager/claim-pod/[workspaceId] - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set the API_TOKEN env var for tests
    process.env.API_TOKEN = VALID_API_TOKEN;
    // Mock global fetch so getProcessList succeeds without a real pod
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_PROCESS_LIST,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  // A strut JOB claiming for itself (strut plans/job-artifact-events.md §2):
  // the claimant is `job:<id>` in the column a task's id goes in, the strut
  // run id is the reason, and no task is touched.
  describe("A strut job as the claimant", () => {
    test("?job=&run= stamps the pod `job:<id>` with the run as the reason, and writes no task", async () => {
      const { owner, workspace, pods } = await createTestWorkspaceScenario({
        withSwarm: true,
        withPods: true,
        podCount: 1,
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}?job=6f1c-job&run=1790000000000`,
        owner,
        {},
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.podId).toBe(pods[0].podId);

      const pod = await db.pod.findUnique({ where: { id: pods[0].id } });
      expect(pod?.usageStatus).toBe("USED");
      expect(pod?.usageStatusMarkedBy).toBe("job:6f1c-job");
      expect(pod?.usageStatusReason).toBe("1790000000000");
      expect(pod?.usageStatusMarkedAt).toBeInstanceOf(Date);
      expect(await db.task.count({ where: { podId: pods[0].podId } })).toBe(0);
    });

    test("without a run the reason stays empty; a taskId wins over a job", async () => {
      const { owner, workspace, pods } = await createTestWorkspaceScenario({
        withSwarm: true,
        withPods: true,
        podCount: 1,
      });
      const task = await createTestTask({ workspaceId: workspace.id, createdById: owner.id });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}?taskId=${task.id}&job=6f1c-job&run=1790000000000`,
        owner,
        {},
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });
      await expectSuccess(response, 200);

      const pod = await db.pod.findUnique({ where: { id: pods[0].id } });
      expect(pod?.usageStatusMarkedBy).toBe(task.id);
      expect(pod?.usageStatusReason).toBeNull();
    });
  });

  // A pod for checking a pool config push (strut plans/pod-config.md §4):
  // `?generation=new` takes only a pod created after the last completed push,
  // never an older one; none ready is 409. Every claim reports `generation`.
  describe("?generation=new", () => {
    async function scenario(pushedAt: Date | null, podCreatedAt: Date[]) {
      const s = await createTestWorkspaceScenario({ withSwarm: true, withPods: true, podCount: podCreatedAt.length });
      await db.swarm.update({ where: { id: s.swarm!.id }, data: { poolPushedAt: pushedAt } });
      for (const [i, createdAt] of podCreatedAt.entries()) {
        await db.pod.update({ where: { id: s.pods[i].id }, data: { createdAt } });
      }
      return s;
    }
    const claim = (workspaceId: string, owner: Parameters<typeof createAuthenticatedPostRequest>[1], query: string) =>
      POST(createAuthenticatedPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspaceId}${query}`, owner, {}), {
        params: Promise.resolve({ workspaceId }),
      });
    const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

    test("claims a pod created after the push and says it is new", async () => {
      const { owner, workspace, pods } = await scenario(minutesAgo(10), [minutesAgo(20), minutesAgo(5)]);

      const data = await expectSuccess(await claim(workspace.id, owner, "?generation=new&job=6f1c-job&run=1790000000000"), 200);

      expect(data.podId).toBe(pods[1].podId);
      expect(data.generation).toBe("new");
      const pod = await db.pod.findUnique({ where: { id: pods[1].id } });
      expect(pod?.usageStatusMarkedBy).toBe("job:6f1c-job");
      expect((await db.pod.findUnique({ where: { id: pods[0].id } }))?.usageStatus).toBe("UNUSED");
    });

    test("409 while only older pods are free — never an older pod", async () => {
      const { owner, workspace, pods } = await scenario(minutesAgo(10), [minutesAgo(20)]);

      const response = await claim(workspace.id, owner, "?generation=new");

      await expectError(response, "No pod created after the last pool push is ready yet", 409);
      expect((await db.pod.findUnique({ where: { id: pods[0].id } }))?.usageStatus).toBe("UNUSED");
    });

    test("409 when no push has completed", async () => {
      const { owner, workspace } = await scenario(null, [minutesAgo(5)]);

      const response = await claim(workspace.id, owner, "?generation=new");

      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/No completed pool push is recorded/);
    });

    test("a plain claim takes an older pod as before, and says so", async () => {
      const { owner, workspace, pods } = await scenario(minutesAgo(10), [minutesAgo(20)]);

      const data = await expectSuccess(await claim(workspace.id, owner, ""), 200);

      expect(data.podId).toBe(pods[0].podId);
      expect(data.generation).toBe("old");
    });
  });
});
