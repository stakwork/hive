import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";

const encryptionService = new EncryptionService();

// Mock next-auth first
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock external dependencies
vi.mock("@/services/swarm/api/swarm", () => ({
  swarmApiRequest: vi.fn(),
}));

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(),
}));

vi.mock("@/lib/constants", () => ({
  getSwarmVanityAddress: vi.fn((name: string) => `${name}.sphinx.chat`),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Import mocked functions after mocking
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { getS3Service } from "@/services/s3";
import { getServerSession } from "next-auth/next";

describe("GET /api/swarm/jarvis/nodes", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string };
  let testSwarm: { id: string; name: string; swarmApiKey: string; swarmUrl: string };
  const baseUrl = "/api/swarm/jarvis/nodes";

  // Helper to create authenticated GET request
  const createAuthenticatedGetRequest = async (
    userId: string,
    workspaceId: string,
    queryParams: Record<string, string> = {}
  ) => {
    const { GET } = await import("@/app/api/swarm/jarvis/nodes/route");
    const url = new URL(`http://localhost:3000${baseUrl}`);
    url.searchParams.set("id", workspaceId);
    
    // Add additional query parameters
    Object.entries(queryParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    // Mock NextAuth session
    const { getServerSession } = await import("next-auth/next");
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: userId, email: testUser.email, name: testUser.name },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    const request = new NextRequest(url.toString(), {
      method: "GET",
    });

    return GET(request as any);
  };

  // Helper to create unauthenticated GET request
  const createUnauthenticatedGetRequest = async (
    workspaceId: string,
    queryParams: Record<string, string> = {}
  ) => {
    const { GET } = await import("@/app/api/swarm/jarvis/nodes/route");
    const url = new URL(`http://localhost:3000${baseUrl}`);
    url.searchParams.set("id", workspaceId);
    
    Object.entries(queryParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    // Mock no session
    const { getServerSession } = await import("next-auth/next");
    vi.mocked(getServerSession).mockResolvedValue(null);

    const request = new NextRequest(url.toString(), {
      method: "GET",
    });

    return GET(request as any);
  };

  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();

    // Create test user
    testUser = await db.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: "Test User",
        emailVerified: new Date(),
      },
    });

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: `test-workspace-${Date.now()}`,
        ownerId: testUser.id,
        members: {
          create: {
            userId: testUser.id,
            role: WorkspaceRole.OWNER,
          },
        },
      },
    });

    // Create test swarm with encrypted API key
    const encryptedApiKey = encryptionService.encryptField(
      "swarmApiKey",
      "test-api-key-123"
    );
    testSwarm = await db.swarm.create({
      data: {
        name: "test-swarm",
        swarmUrl: "https://test-swarm.sphinx.chat:8444",
        swarmApiKey: JSON.stringify(encryptedApiKey),
        workspaceId: testWorkspace.id,
      },
    });

    // Setup default S3 service mock
    const mockS3Service = {
      generatePresignedDownloadUrlForBucket: vi.fn().mockResolvedValue(
        "https://presigned-url.example.com/media.mp3?signature=xyz"
      ),
    };
    vi.mocked(getS3Service).mockReturnValue(mockS3Service as any);
  });

  afterEach(async () => {
    // Cleanup test data
    await db.swarm.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await db.workspaceMember.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });
    await db.workspace.deleteMany({ where: { id: testWorkspace.id } });
    await db.user.deleteMany({ where: { id: testUser.id } });
  });

  describe("Authentication", () => {
    test("returns 401 when user is not authenticated", async () => {
      const response = await createUnauthenticatedGetRequest(testWorkspace.id);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    test("returns 401 when session is missing user id", async () => {
      const { GET } = await import("@/app/api/swarm/jarvis/nodes/route");
      const url = new URL(`http://localhost:3000${baseUrl}`);
      url.searchParams.set("id", testWorkspace.id);

      // Mock session without user id
      const { getServerSession } = await import("next-auth/next");
      vi.mocked(getServerSession).mockResolvedValue({
        user: { email: testUser.email },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      } as any);

      const request = new NextRequest(url.toString(), { method: "GET" });
      const response = await GET(request as any);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    test("allows authenticated user with valid session", async () => {
      // Mock successful Jarvis API response
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [], edges: [] },
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Query Parameters", () => {
    test("uses default endpoint when not provided", async () => {
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [], edges: [] },
      });

      await createAuthenticatedGetRequest(testUser.id, testWorkspace.id);

      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith({
        swarmUrl: expect.stringContaining("8444"),
        endpoint: "graph/search/latest?limit=1000&top_node_count=500",
        method: "GET",
        apiKey: expect.any(String),
      });
    });

    test("uses custom endpoint when provided", async () => {
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [], edges: [] },
      });

      await createAuthenticatedGetRequest(testUser.id, testWorkspace.id, {
        endpoint: "graph/search/custom?limit=50",
      });

      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith({
        swarmUrl: expect.any(String),
        endpoint: "graph/search/custom?limit=50",
        method: "GET",
        apiKey: expect.any(String),
      });
    });

    test("appends node_type parameter to endpoint with ?", async () => {
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [], edges: [] },
      });

      await createAuthenticatedGetRequest(testUser.id, testWorkspace.id, {
        endpoint: "graph/search",
        node_type: "Function",
      });

      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith({
        swarmUrl: expect.any(String),
        endpoint: "graph/search?node_type=Function",
        method: "GET",
        apiKey: expect.any(String),
      });
    });

    test("appends node_type parameter to endpoint with & when ? exists", async () => {
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [], edges: [] },
      });

      await createAuthenticatedGetRequest(testUser.id, testWorkspace.id, {
        endpoint: "graph/search?limit=100",
        node_type: "File",
      });

      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith({
        swarmUrl: expect.any(String),
        endpoint: "graph/search?limit=100&node_type=File",
        method: "GET",
        apiKey: expect.any(String),
      });
    });

    test("handles multiple node types in single request", async () => {
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          nodes: [
            { ref_id: "func-1", node_type: "Function", properties: {} },
            { ref_id: "file-1", node_type: "File", properties: {} },
          ],
          edges: [],
        },
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id,
        { node_type: "Function,File" }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nodes).toHaveLength(2);
    });
  });

  describe("Swarm Configuration", () => {
    test("returns mock data when swarm not found", async () => {
      // Delete swarm to simulate no configuration
      await db.swarm.deleteMany({ where: { workspaceId: testWorkspace.id } });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      // Mock endpoint returns populated data, not empty arrays
      expect(Array.isArray(data.data.nodes)).toBe(true);
      expect(Array.isArray(data.data.edges)).toBe(true);
      expect(data.data.nodes.length).toBeGreaterThan(0);

      // Verify swarmApiRequest was NOT called
      expect(vi.mocked(swarmApiRequest)).not.toHaveBeenCalled();
    });

    test("returns mock data when swarmUrl is null", async () => {
      // Update swarm to have null swarmUrl
      await db.swarm.update({
        where: { id: testSwarm.id },
        data: { swarmUrl: null },
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      // Mock endpoint returns populated data
      expect(Array.isArray(data.data.nodes)).toBe(true);
      expect(data.data.nodes.length).toBeGreaterThan(0);

      // Verify swarmApiRequest was NOT called
      expect(vi.mocked(swarmApiRequest)).not.toHaveBeenCalled();
    });

    test("returns mock data when swarmApiKey is null", async () => {
      // Update swarm to have null swarmApiKey
      await db.swarm.update({
        where: { id: testSwarm.id },
        data: { swarmApiKey: null },
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      // Mock endpoint returns populated data
      expect(Array.isArray(data.data.nodes)).toBe(true);
      expect(data.data.nodes.length).toBeGreaterThan(0);

      // Verify swarmApiRequest was NOT called
      expect(vi.mocked(swarmApiRequest)).not.toHaveBeenCalled();
    });

    test("returns 404 when workspace not found in mock mode", async () => {
      // Delete both swarm and workspace
      await db.swarm.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await db.workspaceMember.deleteMany({
        where: { workspaceId: testWorkspace.id },
      });
      await db.workspace.deleteMany({ where: { id: testWorkspace.id } });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Workspace not found");
    });

    test("uses custom SWARM_URL env var when set", async () => {
      process.env.CUSTOM_SWARM_URL = "https://custom-swarm.example.com";

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [], edges: [] },
      });

      await createAuthenticatedGetRequest(testUser.id, testWorkspace.id);

      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith({
        swarmUrl: "https://custom-swarm.example.com:8444",
        endpoint: expect.any(String),
        method: "GET",
        apiKey: expect.any(String),
      });

      delete process.env.CUSTOM_SWARM_URL;
    });

    test("uses custom SWARM_API_KEY env var when set", async () => {
      process.env.CUSTOM_SWARM_API_KEY = "custom-api-key-456";

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [], edges: [] },
      });

      await createAuthenticatedGetRequest(testUser.id, testWorkspace.id);

      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith({
        swarmUrl: expect.any(String),
        endpoint: expect.any(String),
        method: "GET",
        apiKey: "custom-api-key-456",
      });

      delete process.env.CUSTOM_SWARM_API_KEY;
    });
  });

  describe("External Service Integration", () => {
    test("handles successful Jarvis API response", async () => {
      const mockResponse = {
        nodes: [
          {
            ref_id: "func-1",
            node_type: "Function",
            date_added_to_graph: Date.now(),
            properties: {
              episode_title: "Test Function",
              source_link: "https://example.com",
            },
          },
        ],
        edges: [],
        total_nodes: 1,
        total_edges: 0,
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes).toHaveLength(1);
      expect(data.data.nodes[0].node_type).toBe("Function");
      expect(data.data.total_nodes).toBe(1);
    });

    test("handles Jarvis API error response", async () => {
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: false,
        status: 500,
        data: { error: "Internal server error" },
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    test("handles Jarvis API timeout", async () => {
      vi.mocked(swarmApiRequest).mockRejectedValue(
        new Error("Request timeout")
      );

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to get nodes");
    });

    test("constructs correct Jarvis URL with vanity address", async () => {
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [], edges: [] },
      });

      await createAuthenticatedGetRequest(testUser.id, testWorkspace.id);

      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          swarmUrl: "https://test-swarm.sphinx.chat:8444",
        })
      );
    });

    test("passes decrypted API key to swarmApiRequest", async () => {
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [], edges: [] },
      });

      await createAuthenticatedGetRequest(testUser.id, testWorkspace.id);

      // Verify API key is passed (decrypted)
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: expect.any(String),
        })
      );
    });
  });

  describe("Media URL Processing", () => {
    test("presigns S3 media URLs in response nodes", async () => {
      const mockResponse = {
        nodes: [
          {
            ref_id: "node-1",
            node_type: "Episode",
            date_added_to_graph: Date.now(),
            properties: {
              episode_title: "Test Episode",
              media_url:
                "https://s3.amazonaws.com/sphinx-livekit-recordings/test.mp3",
              source_link: "https://example.com",
            },
          },
        ],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      const mockS3Service = {
        generatePresignedDownloadUrlForBucket: vi
          .fn()
          .mockResolvedValue(
            "https://presigned-url.example.com/test.mp3?signature=xyz"
          ),
      };
      vi.mocked(getS3Service).mockReturnValue(mockS3Service as any);

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes[0].properties.media_url).toContain(
        "presigned-url"
      );
      expect(data.data.nodes[0].properties.media_url).toContain("signature");

      // Verify S3 presigning was called
      expect(
        mockS3Service.generatePresignedDownloadUrlForBucket
      ).toHaveBeenCalledWith("sphinx-livekit-recordings", expect.any(String), 3600);
    });

    test("skips presigning for non-sphinx-livekit URLs", async () => {
      const mockResponse = {
        nodes: [
          {
            ref_id: "node-1",
            node_type: "Episode",
            date_added_to_graph: Date.now(),
            properties: {
              episode_title: "Test Episode",
              media_url: "https://example.com/media.mp3",
              source_link: "https://example.com",
            },
          },
        ],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      const mockS3Service = {
        generatePresignedDownloadUrlForBucket: vi.fn(),
      };
      vi.mocked(getS3Service).mockReturnValue(mockS3Service as any);

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nodes[0].properties.media_url).toBe(
        "https://example.com/media.mp3"
      );

      // Verify S3 presigning was NOT called
      expect(
        mockS3Service.generatePresignedDownloadUrlForBucket
      ).not.toHaveBeenCalled();
    });

    test("handles S3 presigning failure gracefully", async () => {
      const originalUrl =
        "https://s3.amazonaws.com/sphinx-livekit-recordings/test.mp3";
      const mockResponse = {
        nodes: [
          {
            ref_id: "node-1",
            node_type: "Episode",
            date_added_to_graph: Date.now(),
            properties: {
              episode_title: "Test Episode",
              media_url: originalUrl,
              source_link: "https://example.com",
            },
          },
        ],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      const mockS3Service = {
        generatePresignedDownloadUrlForBucket: vi
          .fn()
          .mockRejectedValue(new Error("S3 error")),
      };
      vi.mocked(getS3Service).mockReturnValue(mockS3Service as any);

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      // Should fall back to original URL
      expect(data.data.nodes[0].properties.media_url).toBe(originalUrl);
    });

    test("handles nodes without media_url property", async () => {
      const mockResponse = {
        nodes: [
          {
            ref_id: "node-1",
            node_type: "Function",
            date_added_to_graph: Date.now(),
            properties: {
              episode_title: "Test Function",
              source_link: "https://example.com",
            },
          },
        ],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      const mockS3Service = {
        generatePresignedDownloadUrlForBucket: vi.fn(),
      };
      vi.mocked(getS3Service).mockReturnValue(mockS3Service as any);

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nodes[0].properties.media_url).toBeUndefined();

      // Verify S3 presigning was NOT called
      expect(
        mockS3Service.generatePresignedDownloadUrlForBucket
      ).not.toHaveBeenCalled();
    });

    test("processes multiple nodes with mixed media URLs", async () => {
      const mockResponse = {
        nodes: [
          {
            ref_id: "node-1",
            node_type: "Episode",
            date_added_to_graph: Date.now(),
            properties: {
              media_url:
                "https://s3.amazonaws.com/sphinx-livekit-recordings/test1.mp3",
            },
          },
          {
            ref_id: "node-2",
            node_type: "Episode",
            date_added_to_graph: Date.now(),
            properties: {
              media_url: "https://example.com/test2.mp3",
            },
          },
          {
            ref_id: "node-3",
            node_type: "Function",
            date_added_to_graph: Date.now(),
            properties: {},
          },
        ],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      const mockS3Service = {
        generatePresignedDownloadUrlForBucket: vi
          .fn()
          .mockResolvedValue("https://presigned.example.com/signed.mp3"),
      };
      vi.mocked(getS3Service).mockReturnValue(mockS3Service as any);

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // First node should be presigned
      expect(data.data.nodes[0].properties.media_url).toContain("presigned");
      
      // Second node should remain unchanged
      expect(data.data.nodes[1].properties.media_url).toBe(
        "https://example.com/test2.mp3"
      );
      
      // Third node has no media_url
      expect(data.data.nodes[2].properties.media_url).toBeUndefined();

      // S3 service called only once for sphinx-livekit URL
      expect(
        mockS3Service.generatePresignedDownloadUrlForBucket
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe("Response Format", () => {
    test("returns correct response structure for success", async () => {
      const mockResponse = {
        nodes: [
          {
            ref_id: "func-1",
            node_type: "Function",
            date_added_to_graph: Date.now(),
            properties: {
              episode_title: "Test Function",
              source_link: "https://example.com",
            },
          },
        ],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();

      // Verify response structure
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("status", 200);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("nodes");
      expect(data.data).toHaveProperty("edges");
      expect(Array.isArray(data.data.nodes)).toBe(true);
      expect(Array.isArray(data.data.edges)).toBe(true);
    });

    test("preserves additional response fields from Jarvis", async () => {
      const mockResponse = {
        nodes: [],
        edges: [],
        total_nodes: 100,
        total_edges: 50,
        custom_field: "custom_value",
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.total_nodes).toBe(100);
      expect(data.data.total_edges).toBe(50);
      expect(data.data.custom_field).toBe("custom_value");
    });

    test("handles empty result set", async () => {
      const mockResponse = {
        nodes: [],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes).toHaveLength(0);
      expect(data.data.edges).toHaveLength(0);
    });

    test("handles large result sets", async () => {
      const mockResponse = {
        nodes: Array.from({ length: 500 }, (_, i) => ({
          ref_id: `node-${i}`,
          node_type: "Function",
          date_added_to_graph: Date.now(),
          properties: {
            episode_title: `Function ${i}`,
            source_link: "https://example.com",
          },
        })),
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes).toHaveLength(500);
    });
  });

  describe("Error Handling", () => {
    test("handles database query errors gracefully", async () => {
      // Mock database error
      const originalFindFirst = db.swarm.findFirst;
      db.swarm.findFirst = vi
        .fn()
        .mockRejectedValue(new Error("Database error"));

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to get nodes");

      // Restore original function
      db.swarm.findFirst = originalFindFirst;
    });

    test("handles S3 service initialization error", async () => {
      vi.mocked(getS3Service).mockImplementation(() => {
        throw new Error("S3 initialization failed");
      });

      const mockResponse = {
        nodes: [
          {
            ref_id: "node-1",
            node_type: "Episode",
            date_added_to_graph: Date.now(),
            properties: {
              media_url:
                "https://s3.amazonaws.com/sphinx-livekit-recordings/test.mp3",
            },
          },
        ],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      // Should still succeed but skip media URL processing
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("handles malformed Jarvis response", async () => {
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: null, // Invalid response
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      // Should handle null data gracefully
    });

    test("handles unexpected exceptions in handler", async () => {
      // Mock swarmApiRequest to throw unexpected error
      vi.mocked(swarmApiRequest).mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to get nodes");
    });

    test("handles network errors gracefully", async () => {
      vi.mocked(swarmApiRequest).mockRejectedValue(
        new Error("Network error: ECONNREFUSED")
      );

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to get nodes");
    });
  });

  describe("Role-Based Access", () => {
    const roles: WorkspaceRole[] = [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
      WorkspaceRole.PM,
      WorkspaceRole.DEVELOPER,
      WorkspaceRole.STAKEHOLDER,
      WorkspaceRole.VIEWER,
    ];

    roles.forEach((role) => {
      test(`allows ${role} role to retrieve Jarvis nodes`, async () => {
        // Create test user with specific role
        const roleUser = await db.user.create({
          data: {
            email: `${role.toLowerCase()}-${Date.now()}@example.com`,
            name: `${role} User`,
            emailVerified: new Date(),
          },
        });

        // Add user to workspace with role
        await db.workspaceMember.create({
          data: {
            userId: roleUser.id,
            workspaceId: testWorkspace.id,
            role: role,
          },
        });

        const mockResponse = { nodes: [], edges: [] };
        vi.mocked(swarmApiRequest).mockResolvedValue({
          ok: true,
          status: 200,
          data: mockResponse,
        });

        const response = await createAuthenticatedGetRequest(
          roleUser.id,
          testWorkspace.id
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);

        // Cleanup
        await db.workspaceMember.deleteMany({
          where: { userId: roleUser.id },
        });
        await db.user.delete({ where: { id: roleUser.id } });
      });
    });
  });

  describe("Mock Endpoint Integration", () => {
    test("calls mock endpoint when swarm not configured", async () => {
      // Delete swarm
      await db.swarm.deleteMany({ where: { workspaceId: testWorkspace.id } });

      // Mock fetch to intercept mock endpoint call
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { nodes: [], edges: [], total_nodes: 0, total_edges: 0 },
        }),
      });
      globalThis.fetch = mockFetch as any;

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      
      // Verify mock endpoint was called
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/mock/jarvis/graph"),
        expect.objectContaining({
          headers: expect.any(Object),
        })
      );
    });

    test("passes workspace slug to mock endpoint", async () => {
      await db.swarm.deleteMany({ where: { workspaceId: testWorkspace.id } });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { nodes: [], edges: [] },
        }),
      });
      globalThis.fetch = mockFetch as any;

      await createAuthenticatedGetRequest(testUser.id, testWorkspace.id);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`workspaceSlug=${testWorkspace.slug}`),
        expect.any(Object)
      );
    });
  });

  describe("USE_MOCK_REPOSITORY Environment Variable", () => {
    test("returns mock data when USE_MOCK_REPOSITORY is true", async () => {
      process.env.USE_MOCK_REPOSITORY = "true";

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [{ ref_id: "real-1" }], edges: [] },
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Should return mock data instead of real API response
      expect(data.success).toBe(true);

      delete process.env.USE_MOCK_REPOSITORY;
    });

    test("returns real data when USE_MOCK_REPOSITORY is false", async () => {
      process.env.USE_MOCK_REPOSITORY = "false";

      const realNodes = [{ ref_id: "real-1", node_type: "Function", properties: {} }];
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: realNodes, edges: [] },
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nodes).toEqual(realNodes);

      delete process.env.USE_MOCK_REPOSITORY;
    });
  });
});
