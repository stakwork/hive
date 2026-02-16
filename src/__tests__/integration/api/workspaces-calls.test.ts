import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/calls/route";
import {
  createTestUser,
  createTestWorkspaceScenario,
  mockData,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createGetRequest,
  createAuthenticatedGetRequest,
} from "@/__tests__/support/helpers";
import {
  callMockSetup,
  resetCallMocks,
  createMockCallBatch,
} from "@/__tests__/support/call-mocks";

describe("Calls API - Integration Tests", () => {
  beforeEach(() => {
    resetCallMocks();
  });

  describe("GET /api/workspaces/[slug]/calls", () => {
    test("rejects unauthenticated requests", async () => {
      const { workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      // Request without middleware auth headers
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

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        nonMember,
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

      const calls = createMockCallBatch(2);
      callMockSetup.mockGetCallsSuccess(calls);

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
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

      const calls = createMockCallBatch(2);
      callMockSetup.mockGetCallsSuccess(calls);

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        member,
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

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
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

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
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

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
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

      const calls = createMockCallBatch(2);
      const mockFetch = vi.fn();
      callMockSetup.mockGetCallsSuccess(calls);
      global.fetch = mockFetch.mockImplementation(global.fetch);

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
      );

      await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://swarm38.sphinx.chat:8444/graph/nodes/list?node_type=%5B%22Episode%22%2C%22Call%22%5D&sort_by=date_added_to_graph&order_by=desc&limit=11&skip=0",
        expect.objectContaining({
          method: "GET",
          headers: {
            "x-api-token": "test-swarm-api-key",
          },
        }),
      );
    });

    test("returns formatted call recordings", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      const calls = [
        mockData.call({
          ref_id: "call-1",
          episode_title: "Meeting recording 2025-06-23T14:42:41",
          date_added_to_graph: 1750694095.264704,
          description: "Team sync meeting discussion",
        }),
        mockData.call({
          ref_id: "call-2",
          episode_title: "Meeting recording 2025-06-23T16:51:27",
          date_added_to_graph: 1750699175.5493836,
          description: "Team sync meeting discussion",
        }),
      ];
      callMockSetup.mockGetCallsSuccess(calls);

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
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
        description: "Team sync meeting discussion",
      });
      expect(data.calls[1]).toEqual({
        ref_id: "call-2",
        episode_title: "Meeting recording 2025-06-23T16:51:27",
        date_added_to_graph: 1750699175.5493836,
        description: "Team sync meeting discussion",
      });
      expect(data.total).toBe(2);
      expect(data.hasMore).toBe(false);
    });

    test("handles Jarvis API errors gracefully", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      callMockSetup.mockGetCallsError(500, "Internal Server Error");

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      await expectError(
        response,
        "Failed to fetch call recordings.",
        502,
      );
    });

    test("accepts limit and skip query params", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      callMockSetup.mockEmptyCallList();
      const mockFetch = vi.fn().mockImplementation(global.fetch);
      global.fetch = mockFetch;

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
        { limit: "20", skip: "10" },
      );

      await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://swarm38.sphinx.chat:8444/graph/nodes/list?node_type=%5B%22Episode%22%2C%22Call%22%5D&sort_by=date_added_to_graph&order_by=desc&limit=21&skip=10",
        expect.objectContaining({
          method: "GET",
          headers: {
            "x-api-token": "test-swarm-api-key",
          },
        }),
      );
    });

    test("defaults to limit=10, skip=0", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      callMockSetup.mockEmptyCallList();
      const mockFetch = vi.fn().mockImplementation(global.fetch);
      global.fetch = mockFetch;

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
      );

      await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://swarm38.sphinx.chat:8444/graph/nodes/list?node_type=%5B%22Episode%22%2C%22Call%22%5D&sort_by=date_added_to_graph&order_by=desc&limit=11&skip=0",
        expect.objectContaining({
          method: "GET",
          headers: {
            "x-api-token": "test-swarm-api-key",
          },
        }),
      );
    });

    test("returns correct pagination metadata with hasMore=true", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      // Use helper to mock 10 calls with hasMore=true
      const calls = createMockCallBatch(10, 1750694095);
      callMockSetup.mockGetCallsSuccess(calls, true);

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
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

      // Use helper to mock 5 calls
      const calls = createMockCallBatch(5, 1750694095);
      callMockSetup.mockGetCallsSuccess(calls, false);

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.calls).toHaveLength(5);
      expect(data.total).toBe(5);
      expect(data.hasMore).toBe(false);
    });

    test("returns hasMore=false when exactly limit items returned", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      // Use helper to mock exactly 10 calls without hasMore
      const calls = createMockCallBatch(10, 1750694095);
      callMockSetup.mockGetCallsSuccess(calls, false);

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.calls).toHaveLength(10);
      expect(data.total).toBe(10);
      expect(data.hasMore).toBe(false);
    });

    test("filters out calls with missing episode_title", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      const validCall = mockData.jarvisNode({ ref_id: "valid-1" });
      const invalidNode = mockData.invalidJarvisNode('episode_title');
      
      callMockSetup.mockJarvisApiSuccess([validCall, invalidNode]);

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.calls).toHaveLength(1);
      expect(data.calls[0].ref_id).toBe("valid-1");
    });

    test("filters out calls with missing date_added_to_graph", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      const validCall = mockData.jarvisNode({ ref_id: "valid-1" });
      const invalidNode = mockData.invalidJarvisNode('date_added_to_graph');
      
      callMockSetup.mockJarvisApiSuccess([validCall, invalidNode]);

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.calls).toHaveLength(1);
      expect(data.calls[0].ref_id).toBe("valid-1");
    });

    test("returns empty array when all calls are invalid", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      const invalidNodes = [
        mockData.invalidJarvisNode('episode_title'),
        mockData.invalidJarvisNode('date_added_to_graph'),
        mockData.invalidJarvisNode('both'),
      ];
      
      callMockSetup.mockJarvisApiSuccess(invalidNodes);

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.calls).toHaveLength(0);
      expect(data.total).toBe(0);
      expect(data.hasMore).toBe(false);
    });

    test("provides default title for calls with missing episode_title", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: { status: "ACTIVE", name: "swarm38" },
      });

      const callWithEmptyTitle = {
        ...mockData.jarvisNode(),
        ref_id: 'call-no-title',
        date_added_to_graph: 1750694095.264704,
        properties: {
          media_url: 'https://example.com/media.mp4',
          source_link: 'https://example.com/source',
          episode_title: '', // Empty string should get default
        },
      };
      
      callMockSetup.mockJarvisApiSuccess([callWithEmptyTitle]);

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/calls`,
        owner,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.calls).toHaveLength(1);
      expect(data.calls[0].episode_title).toBe("Untitled Call");
    });
  });
});
