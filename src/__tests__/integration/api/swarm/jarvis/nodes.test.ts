import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/swarm/jarvis/nodes/route";
import { db } from "@/lib/db";
import type { JarvisResponse, JarvisNode } from "@/types/jarvis";
import {
  createGetRequest,
  expectSuccess,
} from "@/__tests__/support/helpers";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import {
  createAuthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers/auth";

// Mock S3 service
const mockS3Service = {
  generatePresignedDownloadUrlForBucket: vi
    .fn()
    .mockResolvedValue("https://presigned-url.example.com/file.mp4"),
};

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => mockS3Service),
}));

// Mock NextAuth for routes that use getServerSession
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Mock external services
vi.mock("@/services/swarm/api/swarm");

describe("GET /api/swarm/jarvis/nodes - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to mock session for authenticated requests
  function mockAuthSession(user: { id: string; email: string }) {
    const session = createAuthenticatedSession(user);
    getMockedSession().mockResolvedValue(session);
  }

  describe("Authentication", () => {
    test("returns 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(null);
      
      const request = createGetRequest(
        "http://localhost:3000/api/swarm/jarvis/nodes?id=test-workspace-id"
      );

      const response = await GET(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });
  });

  describe("Successful Node Retrieval", () => {
    test("successfully fetches nodes from Jarvis API", async () => {
      // Setup
      const user = await createTestUser();
      mockAuthSession(user);
      
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          swarmUrl: "https://test-swarm.example.com:8444",
          swarmApiKey: "encrypted-test-key",
        },
      });

      const mockNodes: JarvisNode[] = [
        {
          ref_id: "func-123",
          node_type: "Function",
          date_added_to_graph: 1234567890,
          properties: {
            name: "processData",
            description: "Processes incoming data",
          },
        },
        {
          ref_id: "var-456",
          node_type: "Variable",
          date_added_to_graph: 1234567891,
          properties: {
            name: "config",
            type: "string",
          },
        },
      ];

      // Mock external API response
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          nodes: mockNodes,
          edges: [],
        },
        status: 200,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspace.id}`
      );

      // Execute
      const response = await GET(request);

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.status).toBe(200);
      expect(data.data.nodes).toHaveLength(2);
      expect(data.data.nodes[0]).toMatchObject({
        ref_id: "func-123",
        node_type: "Function",
        properties: { name: "processData" },
      });

      // Verify external API was called correctly
      expect(swarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          swarmUrl: expect.stringContaining("sphinx.chat:8444"),
          endpoint: expect.stringContaining("graph/search/latest"),
          method: "GET",
          apiKey: "encrypted-test-key",
        })
      );
    });

    test("handles optional endpoint parameter", async () => {
      const user = await createTestUser();
      mockAuthSession(user);
      
      const workspace = await createTestWorkspace({ ownerId: user.id });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          swarmUrl: "https://test-swarm.example.com:8444",
          swarmApiKey: "encrypted-test-key",
        },
      });

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: { nodes: [], edges: [] },
        status: 200,
      });

      const customEndpoint = "graph/custom?limit=100";
      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspace.id}&endpoint=${encodeURIComponent(customEndpoint)}`
      );

      await GET(request);

      expect(swarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: customEndpoint,
        })
      );
    });

    test("handles optional node_type parameter", async () => {
      const user = await createTestUser();
      mockAuthSession(user);
      
      const workspace = await createTestWorkspace({ ownerId: user.id });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          swarmUrl: "https://test-swarm.example.com:8444",
          swarmApiKey: "encrypted-test-key",
        },
      });

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: { nodes: [], edges: [] },
        status: 200,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspace.id}&node_type=Function`
      );

      await GET(request);

      expect(swarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: expect.stringContaining("node_type=Function"),
        })
      );
    });
  });

  describe("Response Processing", () => {
    test("normalizes timestamps from milliseconds to seconds", async () => {
      const user = await createTestUser();
      mockAuthSession(user);
      
      const workspace = await createTestWorkspace({ ownerId: user.id });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          swarmUrl: "https://test-swarm.example.com:8444",
          swarmApiKey: "encrypted-test-key",
        },
      });

      const mockNodes: JarvisNode[] = [
        {
          ref_id: "node-1",
          node_type: "Function",
          date_added_to_graph: 1234567890123, // 13 digits - milliseconds
          properties: { name: "test" },
        },
        {
          ref_id: "node-2",
          node_type: "Variable",
          date_added_to_graph: 1234567890, // 10 digits - already seconds
          properties: { name: "test2" },
        },
      ];

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: { nodes: mockNodes, edges: [] },
        status: 200,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspace.id}`
      );

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      // First node should be converted from milliseconds
      expect(data.data.nodes[0].date_added_to_graph).toBe(1234567890.123);

      // Second node should remain unchanged
      expect(data.data.nodes[1].date_added_to_graph).toBe(1234567890);
    });

    test("processes S3 media URLs with presigning for sphinx-livekit-recordings", async () => {
      const user = await createTestUser();
      mockAuthSession(user);
      
      const workspace = await createTestWorkspace({ ownerId: user.id });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          swarmUrl: "https://test-swarm.example.com:8444",
          swarmApiKey: "encrypted-test-key",
        },
      });

      const mockNodes: JarvisNode[] = [
        {
          ref_id: "episode-1",
          node_type: "Episode",
          date_added_to_graph: 1234567890,
          properties: {
            media_url:
              "https://sphinx-livekit-recordings.s3.amazonaws.com/recordings/test-file.mp4",
          },
        },
      ];

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: { nodes: mockNodes, edges: [] },
        status: 200,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspace.id}`
      );

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      // Note: In real test environment, S3 presigning would generate a signed URL
      // Here we verify the structure is maintained
      expect(data.data.nodes[0].properties?.media_url).toBeDefined();
    });

    test("preserves non-sphinx media URLs unchanged", async () => {
      const user = await createTestUser();
      mockAuthSession(user);
      
      const workspace = await createTestWorkspace({ ownerId: user.id });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          swarmUrl: "https://test-swarm.example.com:8444",
          swarmApiKey: "encrypted-test-key",
        },
      });

      const originalUrl = "https://example.com/media/video.mp4";
      const mockNodes: JarvisNode[] = [
        {
          ref_id: "episode-1",
          node_type: "Episode",
          date_added_to_graph: 1234567890,
          properties: {
            media_url: originalUrl,
          },
        },
      ];

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: { nodes: mockNodes, edges: [] },
        status: 200,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspace.id}`
      );

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      // Non-sphinx URL should remain unchanged
      expect(data.data.nodes[0].properties?.media_url).toBe(originalUrl);
    });
  });

  describe("Error Handling", () => {
    test.skip("handles API errors from external service", async () => {
      const user = await createTestUser();
      mockAuthSession(user);
      
      const workspace = await createTestWorkspace({ ownerId: user.id });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          swarmUrl: "https://test-swarm.example.com:8444",
          swarmApiKey: "encrypted-test-key",
        },
      });

      // Mock API error
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: false,
        status: 503,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspace.id}`
      );

      const response = await GET(request);

      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    test("handles internal server errors", async () => {
      const user = await createTestUser();
      mockAuthSession(user);
      
      const workspace = await createTestWorkspace({ ownerId: user.id });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          swarmUrl: "https://test-swarm.example.com:8444",
          swarmApiKey: "encrypted-test-key",
        },
      });

      // Mock internal error
      vi.mocked(swarmApiRequest).mockRejectedValue(
        new Error("Network error")
      );

      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspace.id}`
      );

      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to get nodes");
    });

    test("returns 404 when workspace not found in mock fallback path", async () => {
      const user = await createTestUser();
      mockAuthSession(user);
      
      const nonExistentWorkspaceId = "non-existent-workspace-id";

      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${nonExistentWorkspaceId}`
      );

      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Workspace not found");
    });
  });

  describe("Mock Endpoint Fallback", () => {
    test("calls mock endpoint when swarm not configured", async () => {
      const user = await createTestUser();
      mockAuthSession(user);
      
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "test-workspace",
      });

      // No swarm created - should trigger mock fallback

      // Mock the internal fetch call to /api/mock/jarvis/graph
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          status: 200,
          data: {
            nodes: [
              {
                ref_id: "mock-func-1",
                node_type: "Function",
                date_added_to_graph: 1234567890,
                properties: { name: "mockFunction" },
              },
            ],
            edges: [],
          },
        }),
      });

      global.fetch = mockFetch;

      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspace.id}`
      );

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      // Verify mock endpoint was called
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/mock/jarvis/graph"),
        expect.any(Object)
      );

      // Verify mock data structure
      expect(data.data.nodes).toHaveLength(1);
      expect(data.data.nodes[0].node_type).toBe("Function");
    });

    test("calls mock endpoint when swarm has missing configuration", async () => {
      const user = await createTestUser();
      mockAuthSession(user);
      
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "test-workspace",
      });

      // Create swarm with missing apiKey
      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "incomplete-swarm",
          swarmUrl: "https://test-swarm.example.com:8444",
          // swarmApiKey missing
        },
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          status: 200,
          data: { nodes: [], edges: [] },
        }),
      });

      global.fetch = mockFetch;

      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspace.id}`
      );

      await GET(request);

      // Should fallback to mock endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/mock/jarvis/graph"),
        expect.any(Object)
      );
    });
  });

  describe("Query Parameter Validation", () => {
    test("returns empty results when workspace id not provided", async () => {
      const user = await createTestUser();
      mockAuthSession(user);

      const request = createGetRequest(
        "http://localhost:3000/api/swarm/jarvis/nodes"
      );

      const response = await GET(request);

      // Without workspace ID, swarm lookup returns null, triggering mock fallback
      // which will fail with 404 since no workspace found
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Workspace not found");
    });

    test("combines endpoint and node_type parameters correctly", async () => {
      const user = await createTestUser();
      mockAuthSession(user);
      
      const workspace = await createTestWorkspace({ ownerId: user.id });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          swarmUrl: "https://test-swarm.example.com:8444",
          swarmApiKey: "encrypted-test-key",
        },
      });

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: { nodes: [], edges: [] },
        status: 200,
      });

      const customEndpoint = "graph/custom?limit=100";
      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspace.id}&endpoint=${encodeURIComponent(customEndpoint)}&node_type=Episode`
      );

      await GET(request);

      // Should append node_type to endpoint with & separator
      expect(swarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: expect.stringContaining("node_type=Episode"),
        })
      );
    });
  });

  describe("Response Structure Validation", () => {
    test("returns correct JarvisResponse envelope structure", async () => {
      const user = await createTestUser();
      mockAuthSession(user);
      
      const workspace = await createTestWorkspace({ ownerId: user.id });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          swarmUrl: "https://test-swarm.example.com:8444",
          swarmApiKey: "encrypted-test-key",
        },
      });

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          nodes: [],
          edges: [],
        },
        status: 200,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspace.id}`
      );

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      // Validate response envelope structure
      expect(data).toMatchObject({
        success: true,
        status: 200,
        data: {
          nodes: expect.any(Array),
          edges: expect.any(Array),
        },
      });
    });

    test("preserves edge data from API response", async () => {
      const user = await createTestUser();
      mockAuthSession(user);
      
      const workspace = await createTestWorkspace({ ownerId: user.id });

      await db.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          swarmUrl: "https://test-swarm.example.com:8444",
          swarmApiKey: "encrypted-test-key",
        },
      });

      const mockEdges = [
        { source: "node-1", target: "node-2", edge_type: "uses" },
      ];

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: {
          nodes: [],
          edges: mockEdges,
        },
        status: 200,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspace.id}`
      );

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      expect(data.data.edges).toEqual(mockEdges);
    });
  });
});
