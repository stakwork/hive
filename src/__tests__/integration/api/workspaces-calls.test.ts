import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/calls/route";
import {
  createTestUser,
  createTestWorkspaceScenario,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  createGetRequest,
} from "@/__tests__/support/helpers";

// Mock Jarvis API response
const mockJarvisResponse = {
  nodes: [
    {
      ref_id: "call-1",
      node_type: "Episode",
      date_added_to_graph: 1750694095.264704,
      properties: {
        episode_title: "Meeting recording 2025-06-23T14:42:41",
        media_url: "https://example.com/recording1.mp4",
        source_link: "https://example.com/recording1.mp4",
      },
    },
    {
      ref_id: "call-2",
      node_type: "Episode",
      date_added_to_graph: 1750699175.5493836,
      properties: {
        episode_title: "Meeting recording 2025-06-23T16:51:27",
        media_url: "https://example.com/recording2.mp4",
        source_link: "https://example.com/recording2.mp4",
      },
    },
  ],
  edges: [],
};

describe("Calls API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe("GET /api/workspaces/[slug]/calls", () => {
    test("rejects unauthenticated requests", async () => {
      const { workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
      );

      const response = await GET(request, {
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
      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Access denied", 403);
    });

    test("allows workspace owner access", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockJarvisResponse,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
    });

    test("allows workspace member access", async () => {
      const { members, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
        memberCount: 1,
      });

      const member = members[0];
      getMockedSession().mockResolvedValue(createAuthenticatedSession(member));

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockJarvisResponse,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
    });

    test("returns error when swarm not configured", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: false,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Swarm not configured or not active", 400);
    });

    test("returns error when swarm not ACTIVE", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "PENDING", name: "swarm38" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Swarm not configured or not active", 400);
    });

    test("returns error when swarm has empty name", async () => {
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(response, "Swarm name not found", 400);
    });

    test("calls Jarvis API with correct endpoint and payload", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockJarvisResponse,
      });
      global.fetch = mockFetch;

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
      );

      await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://swarm38.sphinx.chat:8444/graph/search/attributes",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            node_type: ["Episode"],
            limit: 10,
            skip: 0,
            include_properties: true,
          }),
        }),
      );
    });

    test("returns formatted call recordings", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockJarvisResponse,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.calls).toHaveLength(2);
      expect(data.calls[0]).toEqual({
        ref_id: "call-1",
        episode_title: "Meeting recording 2025-06-23T14:42:41",
        date_added_to_graph: 1750694095.264704,
      });
      expect(data.calls[1]).toEqual({
        ref_id: "call-2",
        episode_title: "Meeting recording 2025-06-23T16:51:27",
        date_added_to_graph: 1750699175.5493836,
      });
      expect(data.total).toBe(2);
      expect(data.hasMore).toBe(false);
    });

    test("handles Jarvis API errors gracefully", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(
        response,
        "Failed to fetch call recordings from Jarvis",
        502,
      );
    });

    test("accepts limit and skip query params", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], edges: [] }),
      });
      global.fetch = mockFetch;

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        { limit: "20", skip: "10" },
      );

      await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://swarm38.sphinx.chat:8444/graph/search/attributes",
        expect.objectContaining({
          body: JSON.stringify({
            node_type: ["Episode"],
            limit: 20,
            skip: 10,
            include_properties: true,
          }),
        }),
      );
    });

    test("defaults to limit=10, skip=0", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], edges: [] }),
      });
      global.fetch = mockFetch;

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
      );

      await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://swarm38.sphinx.chat:8444/graph/search/attributes",
        expect.objectContaining({
          body: JSON.stringify({
            node_type: ["Episode"],
            limit: 10,
            skip: 0,
            include_properties: true,
          }),
        }),
      );
    });

    test("returns correct pagination metadata with hasMore=true", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock response with exactly 10 items (hasMore should be true)
      const tenItems = Array.from({ length: 10 }, (_, i) => ({
        ref_id: `call-${i}`,
        node_type: "Episode",
        date_added_to_graph: 1750694095 + i,
        properties: {
          episode_title: `Meeting ${i}`,
          media_url: `https://example.com/${i}.mp4`,
          source_link: `https://example.com/${i}.mp4`,
        },
      }));

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: tenItems, edges: [] }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.calls).toHaveLength(10);
      expect(data.total).toBe(10);
      expect(data.hasMore).toBe(true);
    });

    test("returns hasMore=false when fewer than limit items", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock response with less than 10 items
      const fiveItems = Array.from({ length: 5 }, (_, i) => ({
        ref_id: `call-${i}`,
        node_type: "Episode",
        date_added_to_graph: 1750694095 + i,
        properties: {
          episode_title: `Meeting ${i}`,
          media_url: `https://example.com/${i}.mp4`,
          source_link: `https://example.com/${i}.mp4`,
        },
      }));

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: fiveItems, edges: [] }),
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.calls).toHaveLength(5);
      expect(data.total).toBe(5);
      expect(data.hasMore).toBe(false);
    });
  });
});
