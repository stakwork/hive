import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import { POST } from "@/app/api/workspaces/[slug]/calls/generate-link/route";
import {
  createTestUser,
  createTestWorkspaceScenario,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createPostRequest,
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers";
import { db } from "@/lib/db";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

// Mock Redis to avoid real Redis connections in integration tests
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn(),
  },
}));

/**
 * Create a SourceControlOrg and a workspace scenario linked to it. The
 * generate-link endpoint now defaults to an org-scope token, which requires
 * the workspace to be linked to a SourceControlOrg.
 */
async function createOrgWorkspaceScenario(
  options: Parameters<typeof createTestWorkspaceScenario>[0] = {},
) {
  const org = await db.sourceControlOrg.create({
    data: {
      id: generateUniqueId("test-org"),
      githubLogin: `org-${generateUniqueId()}`,
      githubInstallationId: Math.floor(Math.random() * 1_000_000_000),
      type: "ORG",
    },
  });

  const scenario = await createTestWorkspaceScenario({
    ...options,
    workspace: {
      ...options.workspace,
      sourceControlOrgId: org.id,
    },
  });

  return { ...scenario, org };
}

// The call base as production sets it: meet's `/rooms/` path plus the room
// prefix, so the LiveKit room is `sphinx.call.-<swarm>.sphinx.chat-.<ts>`.
// Pinned here because `optionalEnvVars` is read once at import.
const { CALL_BASE, callBaseState } = vi.hoisted(() => {
  const base = "https://call.example.com/rooms/sphinx.call.-";
  return { CALL_BASE: base, callBaseState: { value: base as string | undefined } };
});
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    optionalEnvVars: {
      ...actual.optionalEnvVars,
      get LIVEKIT_CALL_BASE_URL() {
        return callBaseState.value;
      },
    },
  };
});

// Jamie is dispatched into the room through LiveKit's agent dispatch API;
// record the dispatches instead of calling LiveKit.
const { mockCreateDispatch } = vi.hoisted(() => ({
  mockCreateDispatch: vi.fn().mockResolvedValue({}),
}));
vi.mock("livekit-server-sdk", () => ({
  AgentDispatchClient: vi.fn().mockImplementation(() => ({ createDispatch: mockCreateDispatch })),
}));

/**
 * The callKey Jamie was dispatched with — the only place it may appear —
 * after checking that the URL carries no credential.
 */
function dispatchedCallKey(url: string): string {
  expect(url).not.toContain("?");
  expect(mockCreateDispatch).toHaveBeenCalledTimes(1);
  const [roomName, agentName, options] = mockCreateDispatch.mock.calls[0];
  // The room meet opens for the link: its whole last path segment
  expect(url).toBe(`https://call.example.com/rooms/${roomName}`);
  expect(agentName).toBe("jamie");
  const { callKey } = JSON.parse(options.metadata);
  expect(callKey).toMatch(/^[0-9a-f]{24}$/);
  return callKey;
}

describe("Generate Call Link API - Integration Tests", () => {
  const originalLiveKit = process.env.LIVEKIT_CALL_BASE_URL;
  const originalJwt = process.env.JWT_SECRET;

  beforeEach(async () => {
    vi.clearAllMocks();
    callBaseState.value = CALL_BASE;
    // Reset redis.set to default OK behaviour before each test
    const { redis } = await import("@/lib/redis");
    vi.mocked(redis.set).mockResolvedValue("OK");
    mockCreateDispatch.mockResolvedValue({});

    // Set default LiveKit URL for tests
    process.env.LIVEKIT_CALL_BASE_URL = "https://call.livekit.io/";
    // The LiveKit project Jamie is dispatched on
    process.env.LIVEKIT_URL = "wss://test.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "test-livekit-key";
    process.env.LIVEKIT_API_SECRET = "test-livekit-secret";
    // JWT_SECRET is required by generate-link to mint a short-lived token
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
  });

  afterEach(() => {
    // Restore original env
    if (originalLiveKit) {
      process.env.LIVEKIT_CALL_BASE_URL = originalLiveKit;
    } else {
      delete process.env.LIVEKIT_CALL_BASE_URL;
    }
    if (originalJwt) {
      process.env.JWT_SECRET = originalJwt;
    } else {
      delete process.env.JWT_SECRET;
    }
  });

  describe("POST /api/workspaces/[slug]/calls/generate-link", () => {
    describe("Authentication Tests", () => {
      test("rejects unauthenticated requests", async () => {
        const { workspace } = await createTestWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm38" },
        });

        // Request without middleware auth headers
        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectUnauthorized(response);
      });

      test("rejects requests with missing user context", async () => {
        const { workspace } = await createTestWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm38" },
        });

        const request = createPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectUnauthorized(response);
      });
    });

    describe("Authorization Tests", () => {
      test("dispatch metadata carries transcript:true only when the workflow env is set", async () => {
        const saved = process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME;
        try {
          for (const [wf, expected] of [
            [undefined, undefined],
            ["call-transcript", true],
          ] as const) {
            if (wf === undefined) delete process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME;
            else process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME = wf;
            mockCreateDispatch.mockClear();
            const { owner, workspace } = await createOrgWorkspaceScenario({
              withSwarm: true,
              swarm: { status: "ACTIVE", name: `swarm-${generateUniqueId()}` },
            });
            const response = await POST(
              createAuthenticatedPostRequest(
                `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
                {},
                owner,
              ),
              { params: Promise.resolve({ slug: workspace.slug }) },
            );
            expect(response.status).toBe(200);
            const meta = JSON.parse(mockCreateDispatch.mock.calls[0][2].metadata);
            expect(meta.transcript).toBe(expected);
          }
        } finally {
          if (saved === undefined) delete process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME;
          else process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME = saved;
        }
      });

      test("allows workspace owner to generate call link", async () => {
        const { owner, workspace } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm38" },
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.url).toBeDefined();
        expect(typeof data.url).toBe("string");

        // The URL carries no credential; Jamie's dispatch carries the callKey
        const callKey = dispatchedCallKey(data.url);

        // Verify redis.set was called with the correct args
        const { redis } = await import("@/lib/redis");
        expect(vi.mocked(redis.set)).toHaveBeenCalledWith(
          `call-token:${callKey}`,
          expect.any(String),
          "EX",
          7200,
        );

        // Verify the stored token is a valid org-scope JWT
        const storedToken = vi.mocked(redis.set).mock.calls[0][1] as string;
        const payload = jwt.verify(storedToken, process.env.JWT_SECRET as string) as Record<string, unknown>;
        expect(payload.scope).toBe("org");
        expect(payload.permissions).toContain("write");
      });

      test("allows workspace admin to generate call link", async () => {
        const { members, workspace } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm38" },
          members: [{ role: "ADMIN" }],
        });

        const admin = members[0];

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          admin,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.url).toBeDefined();
        dispatchedCallKey(data.url); // validates format
      });

      test("allows workspace PM to generate call link", async () => {
        const { members, workspace } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm38" },
          members: [{ role: "PM" }],
        });

        const pm = members[0];

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          pm,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.url).toBeDefined();
      });

      test("allows workspace developer to generate call link", async () => {
        const { members, workspace } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm38" },
          members: [{ role: "DEVELOPER" }],
        });

        const developer = members[0];

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          developer,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.url).toBeDefined();
      });

      test("allows workspace viewer to generate call link", async () => {
        const { members, workspace } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm38" },
          members: [{ role: "VIEWER" }],
        });

        const viewer = members[0];

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          viewer,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.url).toBeDefined();

        // The URL carries no credential; Jamie's dispatch carries the callKey
        dispatchedCallKey(data.url);

        // A viewer is a member, so they get a read-only org token (no write).
        const { redis } = await import("@/lib/redis");
        const storedToken = vi.mocked(redis.set).mock.calls[0][1] as string;
        const payload = jwt.verify(storedToken, process.env.JWT_SECRET as string) as Record<string, unknown>;
        expect(payload.scope).toBe("org");
        expect(payload.permissions).toEqual(["read"]);
      });

      test("rejects non-member access", async () => {
        const { workspace } = await createTestWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm38" },
        });

        const nonMember = await createTestUser();

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          nonMember,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectError(response, "Access denied", 403);
      });
    });

    describe("Validation Tests", () => {
      test("returns error when workspace slug is missing", async () => {
        const { owner } = await createTestWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm38" },
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces//calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: "" }),
        });

        await expectError(response, "Workspace slug or swarmName query parameter is required", 400);
      });

      test("returns error when workspace not found", async () => {
        const owner = await createTestUser();

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/non-existent-slug/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: "non-existent-slug" }),
        });

        await expectError(response, "Workspace not found", 404);
      });

      test("returns error when swarm not configured", async () => {
        const { owner, workspace } = await createTestWorkspaceScenario({
          withSwarm: false,
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectError(response, "Swarm not configured or not active", 400);
      });

      test("returns error when swarm not ACTIVE", async () => {
        const { owner, workspace } = await createTestWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "PENDING", name: "swarm38" },
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectError(response, "Swarm not configured or not active", 400);
      });

      test("returns error when swarm in FAILED state", async () => {
        const { owner, workspace } = await createTestWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "FAILED", name: "swarm38" },
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectError(response, "Swarm not configured or not active", 400);
      });
    });

    describe("Success Cases", () => {
      test("generates call URL with correct format", async () => {
        const { owner, workspace } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm42" },
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        const data = await expectSuccess(response, 200);

        // Verify URL format: ${baseUrl}${swarmName}.sphinx.chat-.${timestamp}, nothing after it
        expect(data.url).toMatch(
          /^https:\/\/call\.example\.com\/rooms\/sphinx\.call\.-swarm42\.sphinx\.chat-\.\d+$/,
        );
        // Jamie is dispatched into the room meet opens for that link — the
        // whole last path segment, the base's prefix included
        const roomName = mockCreateDispatch.mock.calls[0][0];
        expect(roomName).toMatch(/^sphinx\.call\.-swarm42\.sphinx\.chat-\.\d+$/);
        expect(data.url).toBe(`https://call.example.com/rooms/${roomName}`);
      });

      test("timestamp in URL is recent", async () => {
        const { owner, workspace } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm42" },
        });

        const beforeTimestamp = Math.floor(Date.now() / 1000);

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        const afterTimestamp = Math.floor(Date.now() / 1000);

        const data = await expectSuccess(response, 200);

        // Extract timestamp from the end of the URL
        const match = data.url.match(/\.(\d+)$/);
        expect(match).not.toBeNull();

        const urlTimestamp = parseInt(match![1], 10);

        // Timestamp should be within reasonable range (within a few seconds)
        expect(urlTimestamp).toBeGreaterThanOrEqual(beforeTimestamp);
        expect(urlTimestamp).toBeLessThanOrEqual(afterTimestamp + 1);
      });

      test("handles swarm names with special characters", async () => {
        const { owner, workspace } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm-test_123" },
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        const data = await expectSuccess(response, 200);

        expect(data.url).toContain("swarm-test_123.sphinx.chat-.");
      });

      test("stores token in Redis with 2-hour TTL", async () => {
        const { owner, workspace } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm42" },
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        const data = await expectSuccess(response, 200);
        const callKey = dispatchedCallKey(data.url);

        const { redis } = await import("@/lib/redis");
        expect(vi.mocked(redis.set)).toHaveBeenCalledWith(
          `call-token:${callKey}`,
          expect.any(String),
          "EX",
          7200,
        );
      });

      test("writes the call record under the same callKey: the creator, the org, the workspace, the room", async () => {
        const { owner, workspace, org } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm42" },
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        const data = await expectSuccess(response, 200);
        const callKey = dispatchedCallKey(data.url);
        const [roomName] = mockCreateDispatch.mock.calls[0];

        const { redis } = await import("@/lib/redis");
        const write = vi.mocked(redis.set).mock.calls.find(([key]) => key === `call:${callKey}`);
        expect(write).toBeDefined();
        const [, value, ex, ttl] = write!;
        expect([ex, ttl]).toEqual(["EX", 4 * 3600]);
        const record = JSON.parse(value as string);
        expect(record).toMatchObject({
          userId: owner.id,
          orgId: org.id,
          workspaceSlug: workspace.slug,
          roomName,
          conversationId: null,
        });
        expect(Date.parse(record.createdAt)).toBeGreaterThan(Date.now() - 60_000);
      });

      test("a workspace-scope call on a workspace with no org records no org", async () => {
        const { owner, workspace } = await createTestWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm42" },
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link?scope=workspace`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        const data = await expectSuccess(response, 200);
        const callKey = dispatchedCallKey(data.url);
        const { redis } = await import("@/lib/redis");
        const write = vi.mocked(redis.set).mock.calls.find(([key]) => key === `call:${callKey}`);
        expect(JSON.parse(write![1] as string)).toMatchObject({ userId: owner.id, orgId: null });
      });
    });

    describe("Jamie dispatch failure", () => {
      test("returns 502 and drops the callKey when LiveKit refuses the dispatch", async () => {
        mockCreateDispatch.mockRejectedValueOnce(new Error("twirp error: unauthenticated"));

        const { owner, workspace } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm42" },
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectError(response, "Could not start Jamie for the call", 502);
        const { redis } = await import("@/lib/redis");
        const storedKey = vi.mocked(redis.set).mock.calls[0][0];
        expect(vi.mocked(redis.del)).toHaveBeenCalledWith(storedKey);
        // …and the call record beside it.
        const callKey = (storedKey as string).replace(/^call-token:/, "");
        expect(vi.mocked(redis.del)).toHaveBeenCalledWith(`call:${callKey}`);
      });

      test("returns 502 when LiveKit is not configured", async () => {
        delete process.env.LIVEKIT_URL;
        delete process.env.NEXT_PUBLIC_LIVEKIT_URL;

        const { owner, workspace } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm42" },
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectError(response, "Could not start Jamie for the call", 502);
        expect(mockCreateDispatch).not.toHaveBeenCalled();
      });
    });

    describe("LiveKit not configured", () => {
      test("returns 500 when the call base URL is not configured", async () => {
        callBaseState.value = undefined;

        const { owner, workspace } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm42" },
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectError(response, "LiveKit call service not configured", 500);
        expect(mockCreateDispatch).not.toHaveBeenCalled();
      });
    });

    describe("Redis Failure", () => {
      test("returns 500 when Redis write fails", async () => {
        const { redis } = await import("@/lib/redis");
        vi.mocked(redis.set).mockRejectedValueOnce(new Error("Redis connection refused"));

        const { owner, workspace } = await createOrgWorkspaceScenario({
          withSwarm: true,
          swarm: { status: "ACTIVE", name: "swarm42" },
        });

        const request = createAuthenticatedPostRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
          {},
          owner,
        );

        const response = await POST(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        await expectError(response, "Internal server error", 500);
      });
    });
  });
});
