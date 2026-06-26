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

/** Extract the callKey from a call URL and return it as a string. */
function extractCallKey(url: string): string {
  const match = url.match(/\?callKey=([0-9a-f]{24})$/);
  if (!match) throw new Error(`No valid callKey in URL: ${url}`);
  return match[1];
}

describe("Generate Call Link API - Integration Tests", () => {
  const originalLiveKit = process.env.LIVEKIT_CALL_BASE_URL;
  const originalJwt = process.env.JWT_SECRET;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset redis.set to default OK behaviour before each test
    const { redis } = await import("@/lib/redis");
    vi.mocked(redis.set).mockResolvedValue("OK");

    // Set default LiveKit URL for tests
    process.env.LIVEKIT_CALL_BASE_URL = "https://call.livekit.io/";
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

        // URL should carry callKey, not hiveToken
        const callKey = extractCallKey(data.url);
        expect(callKey).toMatch(/^[0-9a-f]{24}$/);

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
        extractCallKey(data.url); // validates format
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

        // URL should carry callKey (not hiveToken)
        const callKey = extractCallKey(data.url);
        expect(callKey).toMatch(/^[0-9a-f]{24}$/);

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

        // Verify URL format: ${baseUrl}${swarmName}.sphinx.chat-.${timestamp}?callKey=<24hexchars>
        expect(data.url).toContain("swarm42.sphinx.chat-.");
        expect(data.url).toMatch(/\.\d+\?callKey=[0-9a-f]{24}$/);
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

        // Extract timestamp from URL (now followed by ?callKey=)
        const match = data.url.match(/\.(\d+)\?callKey=/);
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
        const callKey = extractCallKey(data.url);

        const { redis } = await import("@/lib/redis");
        expect(vi.mocked(redis.set)).toHaveBeenCalledWith(
          `call-token:${callKey}`,
          expect.any(String),
          "EX",
          7200,
        );
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
