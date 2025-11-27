import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/swarm/jarvis/nodes/route";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { createGetRequest } from "@/__tests__/support/helpers/request-builders";
import {
  expectSuccess,
  expectUnauthorized,
  expectNotFound,
  expectError,
} from "@/__tests__/support/helpers/api-assertions";
import {
  getMockedSession,
  createAuthenticatedSession,
} from "@/__tests__/support/helpers/auth";
import {
  createTestUser,
  createTestWorkspace,
  createTestWorkspaceScenario,
} from "@/__tests__/support/fixtures";
import { resetDatabase } from "@/__tests__/support/fixtures/database";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import type { JarvisNode, JarvisResponse } from "@/types/jarvis";

// Mock external services
vi.mock("@/services/swarm/api/swarm");
vi.mock("next-auth");

// Mock S3 service to avoid AWS API calls
vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => ({
    generatePresignedDownloadUrlForBucket: vi.fn().mockResolvedValue(
      "https://sphinx-livekit-recordings.s3.amazonaws.com/recording.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test&X-Amz-Date=20231120T000000Z&X-Amz-Expires=3600&X-Amz-Signature=test&X-Amz-SignedHeaders=host"
    ),
  })),
}));

// Mock fetch for fallback endpoint
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("GET /api/swarm/jarvis/nodes", () => {
  const encryptionService = EncryptionService.getInstance();

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase();

    // Reset fetch mock
    mockFetch.mockReset();
  });

  afterEach(() => {
    // Clean up all spies, stubs, and global mocks
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("Authentication", () => {
    test("returns 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createGetRequest("/api/swarm/jarvis/nodes?id=workspace-id");
      const response = await GET(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe("Unauthorized");
      expect(vi.mocked(swarmApiRequest)).not.toHaveBeenCalled();
    });

    test("returns 401 for invalid session (missing userId)", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes?id=workspace-id");
      const response = await GET(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.message).toBe("Unauthorized");
      expect(vi.mocked(swarmApiRequest)).not.toHaveBeenCalled();
    });
  });

  describe("Workspace & Swarm Configuration", () => {
    test("returns 404 when workspace not found in fallback scenario", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Create request with non-existent workspace ID
      const request = createGetRequest("/api/swarm/jarvis/nodes?id=non-existent-id");
      const response = await GET(request);

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain("Workspace not found");
      expect(vi.mocked(swarmApiRequest)).not.toHaveBeenCalled();
    });

    test("falls back to mock endpoint when swarm not configured", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock fetch for fallback endpoint
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { nodes: [], edges: [] },
        }),
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data).toHaveProperty("success");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/mock/jarvis/graph?workspaceSlug=${workspace.slug}`),
        expect.any(Object)
      );
      expect(vi.mocked(swarmApiRequest)).not.toHaveBeenCalled();
    });

    test("uses swarm configuration when available", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock Jarvis API response
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          nodes: [
            {
              ref_id: "node-1",
              node_type: "episode",
              date_added_to_graph: Date.now(),
              properties: {
                episode_title: "Test Episode",
                media_url: "https://example.com/media.mp3",
                source_link: "https://example.com",
              },
            },
          ],
          edges: [],
        },
        status: 200,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes).toHaveLength(1);
      expect(data.data.nodes[0].ref_id).toBe("node-1");
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("falls back to mock endpoint when swarm has no URL", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      // Create swarm with no URL
      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: workspace.id,
          status: "ACTIVE",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { nodes: [], edges: [] },
        }),
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      await expectSuccess(response);
      expect(mockFetch).toHaveBeenCalled();
      expect(vi.mocked(swarmApiRequest)).not.toHaveBeenCalled();
    });

    test("falls back to mock endpoint when swarm has no API key", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      // Create swarm with URL but no API key
      await db.swarm.create({
        data: {
          name: "test-swarm",
          swarmUrl: "https://test-swarm.sphinx.chat/api",
          workspaceId: workspace.id,
          status: "ACTIVE",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { nodes: [], edges: [] },
        }),
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      await expectSuccess(response);
      expect(mockFetch).toHaveBeenCalled();
      expect(vi.mocked(swarmApiRequest)).not.toHaveBeenCalled();
    });
  });

  describe("External API Integration", () => {
    test("successfully fetches nodes from Jarvis API", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockNodes: JarvisNode[] = [
        {
          ref_id: "node-1",
          node_type: "episode",
          date_added_to_graph: Date.now(),
          properties: {
            episode_title: "Episode 1",
            media_url: "https://example.com/ep1.mp3",
            source_link: "https://example.com/ep1",
          },
        },
        {
          ref_id: "node-2",
          node_type: "episode",
          date_added_to_graph: Date.now(),
          properties: {
            episode_title: "Episode 2",
            media_url: "https://example.com/ep2.mp3",
            source_link: "https://example.com/ep2",
          },
        },
      ];

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          nodes: mockNodes,
          edges: [],
        },
        status: 200,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.data.nodes).toHaveLength(2);
      expect(data.data.edges).toHaveLength(0);
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          endpoint: expect.stringContaining("graph/search/latest"),
        })
      );
    });

    test("handles Jarvis API failures gracefully", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock API failure
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: false,
        data: undefined,
        status: 500,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.success).toBe(false);
    });

    test("appends node_type query param correctly", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: { nodes: [], edges: [] },
        status: 200,
      });

      const request = createGetRequest(
        `/api/swarm/jarvis/nodes?id=${workspace.id}&node_type=episode`
      );
      const response = await GET(request);

      await expectSuccess(response);
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: expect.stringContaining("node_type=episode"),
        })
      );
    });

    test("handles Jarvis API exception errors", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock swarmApiRequest to throw an error
      vi.mocked(swarmApiRequest).mockRejectedValue(new Error("Network timeout"));

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain("Failed to get nodes");
    });
  });

  describe("S3 Media URL Processing", () => {
    test("presigns S3 URLs for sphinx-livekit-recordings", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock node with S3 media URL
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          nodes: [
            {
              ref_id: "node-1",
              node_type: "call",
              date_added_to_graph: Date.now(),
              properties: {
                episode_title: "Test Call",
                media_url: "s3://sphinx-livekit-recordings/recording.mp4",
                source_link: "https://example.com",
              },
            },
          ],
          edges: [],
        },
        status: 200,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      const data = await expectSuccess(response);
      const mediaUrl = data.data.nodes[0].properties.media_url;

      // Verify presigned URL structure
      expect(mediaUrl).toMatch(/^https:\/\/.*\.amazonaws\.com/);
      expect(mediaUrl).toContain("X-Amz-Algorithm");
      expect(mediaUrl).toContain("X-Amz-Credential");
      expect(mediaUrl).toContain("X-Amz-Signature");
      expect(mediaUrl).toContain("X-Amz-Expires");
    });

    test("preserves non-S3 URLs unchanged", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const originalUrl = "https://example.com/media.mp3";

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          nodes: [
            {
              ref_id: "node-1",
              node_type: "episode",
              date_added_to_graph: Date.now(),
              properties: {
                episode_title: "Test Episode",
                media_url: originalUrl,
                source_link: "https://example.com",
              },
            },
          ],
          edges: [],
        },
        status: 200,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes[0].properties.media_url).toBe(originalUrl);
    });

    test("preserves non-sphinx-livekit S3 URLs", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const originalUrl = "s3://other-bucket/file.mp4";

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          nodes: [
            {
              ref_id: "node-1",
              node_type: "call",
              date_added_to_graph: Date.now(),
              properties: {
                episode_title: "Test Call",
                media_url: originalUrl,
                source_link: "https://example.com",
              },
            },
          ],
          edges: [],
        },
        status: 200,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes[0].properties.media_url).toBe(originalUrl);
    });

    test("handles nodes without media_url property", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          nodes: [
            {
              ref_id: "node-1",
              node_type: "person",
              date_added_to_graph: Date.now(),
              properties: {
                episode_title: "Person Node",
                source_link: "https://example.com",
              },
            },
          ],
          edges: [],
        },
        status: 200,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes).toHaveLength(1);
      expect(data.data.nodes[0].properties.media_url).toBeUndefined();
    });

    test("continues processing when S3 presigning fails", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock node with invalid S3 URL path
      const invalidS3Url = "s3://sphinx-livekit-recordings/";

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          nodes: [
            {
              ref_id: "node-1",
              node_type: "call",
              date_added_to_graph: Date.now(),
              properties: {
                episode_title: "Test Call",
                media_url: invalidS3Url,
                source_link: "https://example.com",
              },
            },
            {
              ref_id: "node-2",
              node_type: "episode",
              date_added_to_graph: Date.now(),
              properties: {
                episode_title: "Valid Episode",
                media_url: "https://example.com/valid.mp3",
                source_link: "https://example.com",
              },
            },
          ],
          edges: [],
        },
        status: 200,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      // Should still return 200 with all nodes
      const data = await expectSuccess(response);
      expect(data.data.nodes).toHaveLength(2);
      expect(data.data.nodes[0].properties.media_url).toBeTruthy();
      expect(data.data.nodes[1].properties.media_url).toBe("https://example.com/valid.mp3");
    });
  });

  describe("Query Parameters", () => {
    test("uses default endpoint when not provided", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: { nodes: [], edges: [] },
        status: 200,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      await expectSuccess(response);
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "graph/search/latest?limit=1000&top_node_count=500",
        })
      );
    });

    test("uses custom endpoint when provided", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: { nodes: [], edges: [] },
        status: 200,
      });

      const customEndpoint = "graph/search/custom?limit=100";
      const request = createGetRequest(
        `/api/swarm/jarvis/nodes?id=${workspace.id}&endpoint=${encodeURIComponent(customEndpoint)}`
      );
      const response = await GET(request);

      await expectSuccess(response);
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: customEndpoint,
        })
      );
    });

    test("appends node_type to endpoint with question mark separator", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: { nodes: [], edges: [] },
        status: 200,
      });

      const request = createGetRequest(
        `/api/swarm/jarvis/nodes?id=${workspace.id}&endpoint=graph/search&node_type=episode`
      );
      const response = await GET(request);

      await expectSuccess(response);
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: expect.stringMatching(/graph\/search\?node_type=episode/),
        })
      );
    });

    test("appends node_type to endpoint with ampersand separator", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: { nodes: [], edges: [] },
        status: 200,
      });

      const request = createGetRequest(
        `/api/swarm/jarvis/nodes?id=${workspace.id}&endpoint=graph/search?limit=10&node_type=person`
      );
      const response = await GET(request);

      await expectSuccess(response);
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: expect.stringContaining("limit=10"),
        })
      );
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: expect.stringContaining("node_type=person"),
        })
      );
    });

    test("handles workspace ID without endpoint parameter", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: { nodes: [], edges: [] },
        status: 200,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      await expectSuccess(response);
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          swarmUrl: expect.any(String),
          endpoint: expect.any(String),
          method: "GET",
          apiKey: expect.any(String),
        })
      );
    });
  });

  describe("Response Structure", () => {
    test("returns nodes and edges in JarvisResponse format", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockResponse: JarvisResponse = {
        nodes: [
          {
            ref_id: "node-1",
            node_type: "episode",
            date_added_to_graph: Date.now(),
            properties: {
              episode_title: "Test",
              media_url: "https://example.com/test.mp3",
              source_link: "https://example.com",
            },
          },
        ],
        edges: [
          {
            source: "node-1",
            target: "node-2",
            edge_type: "mentions",
          },
        ],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockResponse,
        status: 200,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.status).toBe(200);
      expect(data.data).toHaveProperty("nodes");
      expect(data.data).toHaveProperty("edges");
      expect(Array.isArray(data.data.nodes)).toBe(true);
      expect(Array.isArray(data.data.edges)).toBe(true);
      expect(data.data.nodes[0]).toMatchObject({
        ref_id: "node-1",
        node_type: "episode",
      });
    });

    test("returns correct status codes for API responses", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Test 404 from external API
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: false,
        data: undefined,
        status: 404,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.status).toBe(404);
    });

    test("preserves additional response properties", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockResponse: JarvisResponse = {
        nodes: [],
        edges: [],
        metadata: {
          total_count: 100,
          page: 1,
        },
        timestamp: Date.now(),
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockResponse,
        status: 200,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data).toHaveProperty("metadata");
      expect(data.data).toHaveProperty("timestamp");
      expect(data.data.metadata).toEqual({
        total_count: 100,
        page: 1,
      });
    });
  });

  describe("Error Handling", () => {
    test("returns 500 on unexpected errors", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock swarmApiRequest to throw an error
      vi.mocked(swarmApiRequest).mockRejectedValue(new Error("Network error"));

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain("Failed to get nodes");
    });

    test("handles malformed Jarvis API responses", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock malformed response (missing nodes/edges)
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          invalid_field: "test",
        },
        status: 200,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      // Should still return 200 with the malformed data
      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty("invalid_field");
    });

    test("continues with original data when S3 processing fails completely", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const originalUrl = "s3://sphinx-livekit-recordings/test.mp4";

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          nodes: [
            {
              ref_id: "node-1",
              node_type: "call",
              date_added_to_graph: Date.now(),
              properties: {
                episode_title: "Test",
                media_url: originalUrl,
                source_link: "https://example.com",
              },
            },
          ],
          edges: [],
        },
        status: 200,
      });

      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace.id}`);
      const response = await GET(request);

      // Should still return 200 even if S3 processing fails
      const data = await expectSuccess(response);
      expect(data.data.nodes).toHaveLength(1);
      expect(data.success).toBe(true);
    });
  });

  describe("Workspace Isolation", () => {
    test("only returns nodes for requested workspace", async () => {
      const user = await createTestUser();

      // Create two workspaces with swarms
      const workspace1 = await createTestWorkspace({ ownerId: user.id, name: "Workspace 1" });
      const encryptedApiKey1 = JSON.stringify(
        encryptionService.encryptField("swarmApiKey", "test-key-1")
      );
      await db.swarm.create({
        data: {
          name: "swarm1.sphinx.chat",
          swarmUrl: "https://swarm1.sphinx.chat/api",
          swarmApiKey: encryptedApiKey1,
          status: "ACTIVE",
          workspaceId: workspace1.id,
        },
      });

      const workspace2 = await createTestWorkspace({ ownerId: user.id, name: "Workspace 2" });
      const encryptedApiKey2 = JSON.stringify(
        encryptionService.encryptField("swarmApiKey", "test-key-2")
      );
      await db.swarm.create({
        data: {
          name: "swarm2.sphinx.chat",
          swarmUrl: "https://swarm2.sphinx.chat/api",
          swarmApiKey: encryptedApiKey2,
          status: "ACTIVE",
          workspaceId: workspace2.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock different responses for each workspace
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          nodes: [
            {
              ref_id: "workspace1-node",
              node_type: "episode",
              date_added_to_graph: Date.now(),
              properties: {
                episode_title: "Workspace 1 Episode",
                media_url: "https://example.com/ws1.mp3",
                source_link: "https://example.com",
              },
            },
          ],
          edges: [],
        },
        status: 200,
      });

      // Request nodes for workspace 1
      const request = createGetRequest(`/api/swarm/jarvis/nodes?id=${workspace1.id}`);
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes).toHaveLength(1);
      expect(data.data.nodes[0].ref_id).toBe("workspace1-node");

      // Verify swarmApiRequest was called with workspace1's swarm config
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          swarmUrl: expect.stringContaining("swarm1"),
        })
      );
    });
  });

  // IMPORTANT: This test must run LAST in the file due to db spy interference with other tests
  describe("Database Error Handling (LAST)", () => {
    test("handles database errors gracefully", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock db.swarm.findFirst to throw an error (use Once to auto-restore)
      vi.spyOn(db.swarm, "findFirst").mockRejectedValueOnce(new Error("Database connection failed"));

      const request = createGetRequest("/api/swarm/jarvis/nodes?id=workspace-id");
      const response = await GET(request);

      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain("Failed to get nodes");
    });
  });
});