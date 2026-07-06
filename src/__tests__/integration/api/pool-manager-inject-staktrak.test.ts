import { describe, test, beforeEach, afterEach, vi, expect } from "vitest";
import { POST } from "@/app/api/pool-manager/inject-staktrak/[workspaceId]/route";
import {
  expectSuccess,
  expectForbidden,
  expectNotFound,
  expectError,
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
} from "@/__tests__/support/fixtures";
import { createTestPod } from "@/__tests__/support/factories/pod.factory";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

const VALID_API_TOKEN = "test-api-token-secret";

// Mock rate limiter — default to allowed
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

// Mock buildPodUrl so we can intercept the agent URL
vi.mock("@/lib/pods", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pods")>();
  return {
    ...actual,
    buildPodUrl: vi.fn().mockReturnValue("https://pod-15552.test.pods.example.com"),
  };
});

describe("POST /api/pool-manager/inject-staktrak/[workspaceId] - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_TOKEN = VALID_API_TOKEN;

    // Default: rate limit allows
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true });

    // Default: fetch succeeds (agent accepts job)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "accepted" }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Authentication ──────────────────────────────────────────────────────

  describe("Authentication", () => {
    test("returns 401 when no auth headers and no api token", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/inject-staktrak/ws-id",
        { podId: "pod-123" },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "ws-id" }),
      });

      expect(response.status).toBe(401);
    });

    test("returns 401 when x-api-token is invalid and no session", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/pool-manager/inject-staktrak/ws-id",
        "POST",
        { "x-api-token": "wrong-token" },
        { podId: "pod-123" },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "ws-id" }),
      });

      expect(response.status).toBe(401);
    });
  });

  // ── Input Validation ────────────────────────────────────────────────────

  describe("Input validation", () => {
    test("returns 400 when workspaceId is missing", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/inject-staktrak/",
        { podId: "pod-123" },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "" }),
      });

      await expectError(response, "Missing required field: workspaceId", 400);
    });

    test("returns 400 when podId is missing in body", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
        owner,
        {},
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Missing required field: podId", 400);
    });
  });

  // ── Workspace/Access Checks ─────────────────────────────────────────────

  describe("Workspace access", () => {
    test("returns 404 when workspace does not exist", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/pool-manager/inject-staktrak/nonexistent",
        user,
        { podId: "pod-123" },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "nonexistent" }),
      });

      await expectNotFound(response, "Workspace not found");
    });

    test("returns 403 when authenticated user is not owner or member", async () => {
      const { workspace } = await createTestWorkspaceScenario({ withSwarm: true });
      const outsider = await createTestUser();

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
        outsider,
        { podId: "pod-123" },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectForbidden(response, "Access denied");
    });

    test("returns 404 when workspace has no swarm", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      // Ensure no swarm
      await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
        owner,
        { podId: "pod-123" },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectNotFound(response, "No swarm found for this workspace");
    });
  });

  // ── IDOR Guard ──────────────────────────────────────────────────────────

  describe("IDOR guard", () => {
    test("returns 404 when podId does not exist", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({ withSwarm: true });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
        owner,
        { podId: "nonexistent-pod" },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectNotFound(response, "Pod not found");
    });

    test("returns 403 when podId belongs to a different workspace swarm (IDOR)", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({ withSwarm: true });

      // Create a separate workspace with its own swarm and pod
      const { workspace: otherWorkspace } = await createTestWorkspaceScenario({ withSwarm: true });
      const otherSwarm = await db.swarm.findFirst({
        where: { workspaceId: otherWorkspace.id },
      });
      const alienPod = await createTestPod({ swarmId: otherSwarm!.id });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
        owner,
        { podId: alienPod.podId },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectForbidden(response, "Access denied");
    });
  });

  // ── Rate Limiting ───────────────────────────────────────────────────────

  describe("Rate limiting", () => {
    test("returns 429 when rate limit is exceeded", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({ withSwarm: true });
      const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
      const pod = await createTestPod({ swarmId: swarm!.id });

      vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfter: 90 });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
        owner,
        { podId: pod.podId },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("90");
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  // ── Atomic Dispatch Gate ────────────────────────────────────────────────

  describe("Atomic dispatch gate", () => {
    test("returns { alreadyInjected: true } and does NOT call agent when staktrakInjected is already true", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({ withSwarm: true });

      // Mark as already injected
      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { staktrakInjected: true },
      });

      const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
      const pod = await createTestPod({ swarmId: swarm!.id });

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      vi.stubGlobal("fetch", mockFetch);

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
        owner,
        { podId: pod.podId },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.alreadyInjected).toBe(true);

      // Agent must NOT have been called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("dispatches to agent exactly once for concurrent requests (atomic gate)", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({ withSwarm: true });
      const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
      const pod = await createTestPod({ swarmId: swarm!.id });

      let agentCallCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(() => {
          agentCallCount++;
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }),
      );

      const makeRequest = () =>
        POST(
          createAuthenticatedPostRequest(
            `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
            owner,
            { podId: pod.podId },
          ),
          { params: Promise.resolve({ workspaceId: workspace.id }) },
        );

      // Fire two concurrent requests
      const [r1, r2] = await Promise.all([makeRequest(), makeRequest()]);

      // One must succeed with injection, the other must get alreadyInjected
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      const results = [d1, d2];

      const injected = results.filter((r) => r.success === true && !r.alreadyInjected);
      const skipped = results.filter((r) => r.success === true && r.alreadyInjected === true);

      expect(injected.length).toBe(1);
      expect(skipped.length).toBe(1);

      // Agent was called exactly once
      expect(agentCallCount).toBe(1);
    });
  });

  // ── Successful Dispatch ─────────────────────────────────────────────────

  describe("Successful dispatch", () => {
    test("posts to agent with pod.password as Bearer (no decryption call)", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({ withSwarm: true });
      const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
      const pod = await createTestPod({ swarmId: swarm!.id });

      // Capture the Authorization header sent to the agent
      let capturedAuthHeader: string | null = null;
      let capturedBody: any = null;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
          const headers = opts.headers as Record<string, string>;
          capturedAuthHeader = headers["Authorization"] ?? null;
          capturedBody = opts.body ? JSON.parse(opts.body as string) : null;
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }),
      );

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
        owner,
        { podId: pod.podId },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      // The endpoint must use pod.password directly as Bearer (no decryption layer)
      // pod.password is the raw DB value — endpoint uses it verbatim
      expect(capturedAuthHeader).toMatch(/^Bearer .+/);

      // The prompt must be included in the agent request body
      expect(capturedBody?.prompt).toBeTruthy();
      expect(capturedBody.prompt).toContain("staktrak");

      // The inject-staktrak route does NOT import EncryptionService,
      // so decryptField can never be invoked — confirmed by design.
    });

    test("returns 200 { success: true } when agent accepts the job", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({ withSwarm: true });
      const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
      const pod = await createTestPod({ swarmId: swarm!.id });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
        owner,
        { podId: pod.podId },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.alreadyInjected).toBeUndefined();
    });

    test("returns 502 when agent endpoint returns non-ok response", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({ withSwarm: true });
      const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
      const pod = await createTestPod({ swarmId: swarm!.id });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 503 }),
      );

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
        owner,
        { podId: pod.podId },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expect(response.status).toBe(502);
    });

    test("returns 502 when agent endpoint is unreachable (network error)", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({ withSwarm: true });
      const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
      const pod = await createTestPod({ swarmId: swarm!.id });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      );

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
        owner,
        { podId: pod.podId },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expect(response.status).toBe(502);
    });

    test("API token auth bypasses ownership check and can dispatch", async () => {
      const { workspace } = await createTestWorkspaceScenario({ withSwarm: true });
      const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
      const pod = await createTestPod({ swarmId: swarm!.id });

      const request = createRequestWithHeaders(
        `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
        "POST",
        { "x-api-token": VALID_API_TOKEN },
        { podId: pod.podId },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    test("workspace member can dispatch (not just owner)", async () => {
      const { workspace, members } = await createTestWorkspaceScenario({
        withSwarm: true,
        members: [{ role: "DEVELOPER" }],
      });
      const swarm = await db.swarm.findFirst({ where: { workspaceId: workspace.id } });
      const pod = await createTestPod({ swarmId: swarm!.id });

      const member = members[0]; // User object directly

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/pool-manager/inject-staktrak/${workspace.id}`,
        member,
        { podId: pod.podId },
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });
});
