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
    // Set up environment variable for tests
    process.env.LIVEKIT_CALL_BASE_URL = "https://chat.sphinx.chat/rooms/sphinx.call.-";
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
    test("rejects unauthenticated requests", async () => {
      const { workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      // Request without middleware auth headers
      const request = createPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectUnauthorized(response);
    });

    test("rejects non-member access", async () => {
      const { workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      const nonMember = await createTestUser();

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
        nonMember,
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Access denied", 403);
    });

    test("allows workspace owner to generate call link", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      // Mock Date.now to get predictable timestamp
      const mockTimestamp = 1750694095;
      vi.spyOn(Date, "now").mockReturnValue(mockTimestamp * 1000);

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
        owner,
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.url).toBe(
        `https://chat.sphinx.chat/rooms/sphinx.call.-swarm38.sphinx.chat-.${mockTimestamp}`
      );
    });

    test("allows workspace member to generate call link", async () => {
      const { members, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
        memberCount: 1,
      });

      const member = members[0];

      // Mock Date.now to get predictable timestamp
      const mockTimestamp = 1750694095;
      vi.spyOn(Date, "now").mockReturnValue(mockTimestamp * 1000);

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
        member,
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.url).toBe(
        `https://chat.sphinx.chat/rooms/sphinx.call.-swarm38.sphinx.chat-.${mockTimestamp}`
      );
    });

    test("generates URL with correct format", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "test-swarm-123" },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
        owner,
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      // Verify URL format
      expect(data.url).toMatch(
        /^https:\/\/chat\.sphinx\.chat\/rooms\/sphinx\.call\.-test-swarm-123\.sphinx\.chat-\.\d+$/
      );
    });

    test("generates URL with current Unix timestamp", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      const beforeTimestamp = Math.floor(Date.now() / 1000);

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
        owner,
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const afterTimestamp = Math.floor(Date.now() / 1000);

      const data = await expectSuccess(response, 200);

      // Extract timestamp from URL
      const urlMatch = data.url.match(/\.sphinx\.chat-\.(\d+)$/);
      expect(urlMatch).not.toBeNull();

      const urlTimestamp = parseInt(urlMatch![1], 10);
      expect(urlTimestamp).toBeGreaterThanOrEqual(beforeTimestamp);
      expect(urlTimestamp).toBeLessThanOrEqual(afterTimestamp);
    });

    test("returns error when workspace not found", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/non-existent-slug/calls/generate-link`,
        user,
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
        owner,
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Swarm not configured or not active", 400);
    });

    test("returns error when swarm status is not ACTIVE", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "PENDING", name: "swarm38" },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
        owner,
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Swarm not configured or not active", 400);
    });

    test("returns error when swarm status is FAILED", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "FAILED", name: "swarm38" },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
        owner,
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Swarm not configured or not active", 400);
    });

    test("returns error when swarm name is empty", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      // Update swarm to have an empty name
      const { db } = await import("@/lib/db");
      await db.swarm.update({
        where: { id: swarm!.id },
        data: { name: "" },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
        owner,
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Swarm name not found", 400);
    });

    test("returns error when swarm name is null", async () => {
      const { owner, workspace, swarm } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      // Update swarm to have null name
      const { db } = await import("@/lib/db");
      await db.swarm.update({
        where: { id: swarm!.id },
        data: { name: null },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
        owner,
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Swarm name not found", 400);
    });

    test("returns error when LIVEKIT_CALL_BASE_URL not configured", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      // Remove environment variable
      delete process.env.LIVEKIT_CALL_BASE_URL;

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
        owner,
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "LiveKit call service not configured", 500);
    });

    test("handles swarm name with special characters", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm-test_123" },
      });

      const mockTimestamp = 1750694095;
      vi.spyOn(Date, "now").mockReturnValue(mockTimestamp * 1000);

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
        owner,
      );

      const response = await POST(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.url).toBe(
        `https://chat.sphinx.chat/rooms/sphinx.call.-swarm-test_123.sphinx.chat-.${mockTimestamp}`
      );
    });

    test("generates unique URLs for multiple calls", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      // First call
      const request1 = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
        owner,
      );

      const response1 = await POST(request1, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data1 = await expectSuccess(response1, 200);

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second call
      const request2 = createAuthenticatedPostRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls/generate-link`,
        owner,
      );

      const response2 = await POST(request2, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data2 = await expectSuccess(response2, 200);

      // URLs should be different due to timestamp
      expect(data1.url).not.toBe(data2.url);
    });
  });
});
