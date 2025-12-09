import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
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

describe("Generate Call Link API - Integration Tests", () => {
  const originalEnv = process.env.LIVEKIT_CALL_BASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    // Set default LiveKit URL for tests
    process.env.LIVEKIT_CALL_BASE_URL = "https://call.livekit.io/";
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv) {
      process.env.LIVEKIT_CALL_BASE_URL = originalEnv;
    } else {
      delete process.env.LIVEKIT_CALL_BASE_URL;
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
        const { owner, workspace } = await createTestWorkspaceScenario({
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
      });

      test("allows workspace admin to generate call link", async () => {
        const { members, workspace } = await createTestWorkspaceScenario({
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
      });

      test("allows workspace PM to generate call link", async () => {
        const { members, workspace } = await createTestWorkspaceScenario({
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
        const { members, workspace } = await createTestWorkspaceScenario({
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
        const { members, workspace } = await createTestWorkspaceScenario({
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

        await expectError(response, "Workspace slug is required", 400);
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

      // NOTE: This test is no longer valid after implementing mock mode
      // The config now provides a fallback URL (either mock or production default)
      // so LIVEKIT_CALL_BASE_URL is never truly "not configured"
      // 
      // test("returns error when LIVEKIT_CALL_BASE_URL not configured", async () => {
      //   delete process.env.LIVEKIT_CALL_BASE_URL;
      //
      //   const { owner, workspace } = await createTestWorkspaceScenario({
      //     withSwarm: true,
      //     swarm: { status: "ACTIVE", name: "swarm38" },
      //   });
      //
      //   const request = createAuthenticatedPostRequest(
      //     `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
      //     {},
      //     owner,
      //   );
      //
      //   const response = await POST(request, {
      //     params: Promise.resolve({ slug: workspace.slug }),
      //   });
      //
      //   await expectError(response, "LiveKit call service not configured", 500);
      // });
    });

    describe("Success Cases", () => {
      test("generates call URL with correct format", async () => {
        const { owner, workspace } = await createTestWorkspaceScenario({
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

        // Verify URL format: ${baseUrl}${swarmName}.sphinx.chat-.${timestamp}
        // Tests run in mock mode by default, so expect mock URL format
        expect(data.url).toContain("swarm42.sphinx.chat-.");
        expect(data.url).toMatch(/\.(\d+)$/); // Ends with timestamp
      });

      test("timestamp in URL is recent", async () => {
        const { owner, workspace } = await createTestWorkspaceScenario({
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

        // Extract timestamp from URL
        const match = data.url.match(/\.(\d+)$/);
        expect(match).not.toBeNull();

        const urlTimestamp = parseInt(match![1], 10);

        // Timestamp should be within reasonable range (within a few seconds)
        expect(urlTimestamp).toBeGreaterThanOrEqual(beforeTimestamp);
        expect(urlTimestamp).toBeLessThanOrEqual(afterTimestamp + 1);
      });

      test("handles swarm names with special characters", async () => {
        const { owner, workspace } = await createTestWorkspaceScenario({
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
    });

    //describe("Error Handling", () => {
    //  test("handles internal errors gracefully", async () => {
    //    const { owner, workspace } = await createTestWorkspaceScenario({
    //      withSwarm: true,
    //      swarm: { status: "ACTIVE", name: "swarm38" },
    //    });

    //    // Mock db to throw an error
    //    const { db } = await import("@/lib/db");
    //    const originalFindFirst = db.workspace.findFirst;
    //    vi.spyOn(db.workspace, "findFirst").mockRejectedValueOnce(
    //      new Error("Database error"),
    //    );

    //    const request = createAuthenticatedPostRequest(
    //      `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
    //      {},
    //      owner,
    //    );

    //    const response = await POST(request, {
    //      params: Promise.resolve({ slug: workspace.slug }),
    //    });

    //    await expectError(response, "Internal server error", 500);

    //    // Restore original implementation
    //    db.workspace.findFirst = originalFindFirst;
    //  });
    //});
  });

  // NOTE: Mock mode tests removed because:
  // 1. fetch() to localhost:3000 doesn't work in integration tests (no server running)
  // 2. config.LIVEKIT_CALL_BASE_URL is evaluated at module load time, so process.env changes
  //    after import have no effect. USE_MOCKS is determined at startup, not runtime.
  // The mock endpoint itself is tested via E2E tests where a real server is running.
});
