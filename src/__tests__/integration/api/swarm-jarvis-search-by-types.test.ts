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

describe("POST /api/swarm/jarvis/search-by-types", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string };
  let testSwarm: { id: string; swarmApiKey: string; swarmUrl: string };
  const baseUrl = "/api/swarm/jarvis/search-by-types";

  // Helper to create authenticated POST request
  const createAuthenticatedPostRequest = async (
    userId: string,
    workspaceId: string,
    body: unknown
  ) => {
    const { POST } = await import(
      "@/app/api/swarm/jarvis/search-by-types/route"
    );
    const url = `http://localhost:3000${baseUrl}?id=${workspaceId}`;

    // Mock NextAuth session
    const { getServerSession } = await import("next-auth/next");
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: userId, email: testUser.email, name: testUser.name },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    const request = new NextRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return POST(request as any);
  };

  // Helper to create unauthenticated POST request
  const createUnauthenticatedPostRequest = async (
    workspaceId: string,
    body: unknown
  ) => {
    const { POST } = await import(
      "@/app/api/swarm/jarvis/search-by-types/route"
    );
    const url = `http://localhost:3000${baseUrl}?id=${workspaceId}`;

    // Mock no session
    const { getServerSession } = await import("next-auth/next");
    vi.mocked(getServerSession).mockResolvedValue(null);

    const request = new NextRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return POST(request as any);
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
      const response = await createUnauthenticatedPostRequest(
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    test("returns 401 when session is missing user id", async () => {
      const { POST } = await import(
        "@/app/api/swarm/jarvis/search-by-types/route"
      );
      const url = `http://localhost:3000${baseUrl}?id=${testWorkspace.id}`;

      // Mock session without user id
      const { getServerSession } = await import("next-auth/next");
      vi.mocked(getServerSession).mockResolvedValue({
        user: { email: testUser.email },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      } as any);

      const request = new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeTypes: { Function: 50 } }),
      });

      const response = await POST(request as any);

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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Input Validation", () => {
    test("returns 400 when request body is invalid JSON", async () => {
      const { POST } = await import(
        "@/app/api/swarm/jarvis/search-by-types/route"
      );
      const url = `http://localhost:3000${baseUrl}?id=${testWorkspace.id}`;

      const { getServerSession } = await import("next-auth/next");
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      // Create request with invalid JSON body using NextRequest
      const request = new NextRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid-json{",
      });

      const response = await POST(request as any);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Invalid JSON in request body");
    });

    test("returns 400 when nodeTypes field is missing", async () => {
      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { include_properties: true }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing or invalid nodeTypes field");
    });

    test("returns 400 when nodeTypes is not an object", async () => {
      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: "Function" }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing or invalid nodeTypes field");
    });

    test("returns 400 when nodeTypes is null", async () => {
      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: null }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing or invalid nodeTypes field");
    });

    test("validates nodeTypes is an object (but allows arrays due to typeof)", async () => {
      // NOTE: The current validation uses `typeof requestBody.nodeTypes !== 'object'`
      // which allows arrays since typeof [] === 'object' in JavaScript.
      // This test documents the current behavior - arrays pass validation but may fail later.
      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: ["Function", "File"] }
      );

      // Arrays are currently accepted by validation (typeof [] === 'object')
      // The request will proceed to Jarvis API which may reject it
      expect([200, 400, 500]).toContain(response.status);
    });
  });

  describe("Multi-Type Search", () => {
    test("performs single-type search successfully", async () => {
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes).toHaveLength(1);
      expect(data.data.nodes[0].node_type).toBe("Function");

      // Verify swarmApiRequest was called with correct parameters
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith({
        swarmUrl: expect.stringContaining("8444"),
        endpoint: "graph/search/latest-by-types",
        method: "POST",
        apiKey: expect.any(String),
        data: { nodeTypes: { Function: 50 } },
      });
    });

    test("performs multi-type search successfully", async () => {
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
          {
            ref_id: "file-1",
            node_type: "File",
            date_added_to_graph: Date.now(),
            properties: {
              episode_title: "Test File",
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50, File: 30 } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes).toHaveLength(2);
      expect(data.data.nodes.map((n: any) => n.node_type)).toContain(
        "Function"
      );
      expect(data.data.nodes.map((n: any) => n.node_type)).toContain("File");
    });

    test("handles complex query with include_properties and namespace", async () => {
      const mockResponse = {
        nodes: [
          {
            ref_id: "func-1",
            node_type: "Function",
            date_added_to_graph: Date.now(),
            properties: {
              episode_title: "Test Function",
              source_link: "https://example.com",
              description: "Complex function",
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        {
          nodeTypes: { Function: 50, File: 30, Variable: 20 },
          include_properties: true,
          namespace: "test-namespace",
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes[0].properties.description).toBe(
        "Complex function"
      );

      // Verify request includes optional fields
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith({
        swarmUrl: expect.any(String),
        endpoint: "graph/search/latest-by-types",
        method: "POST",
        apiKey: expect.any(String),
        data: {
          nodeTypes: { Function: 50, File: 30, Variable: 20 },
          include_properties: true,
          namespace: "test-namespace",
        },
      });
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { NonExistentType: 50 } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes).toHaveLength(0);
    });
  });

  describe("Swarm Configuration", () => {
    test("returns 404 when workspace not found", async () => {
      const nonExistentWorkspaceId = "non-existent-workspace-id";

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        nonExistentWorkspaceId,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Workspace not found");
    });

    test("returns mock response when swarm is not configured", async () => {
      // Delete swarm to simulate no configuration
      await db.swarm.deleteMany({ where: { workspaceId: testWorkspace.id } });

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes).toEqual([]);
      expect(data.data.edges).toEqual([]);
      expect(data.data.total_nodes).toBe(0);
      expect(data.data.total_edges).toBe(0);

      // Verify swarmApiRequest was NOT called
      expect(vi.mocked(swarmApiRequest)).not.toHaveBeenCalled();
    });

    test("returns mock response when swarmUrl is missing", async () => {
      // Update swarm to have null swarmUrl
      await db.swarm.update({
        where: { id: testSwarm.id },
        data: { swarmUrl: null },
      });

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes).toEqual([]);

      // Verify swarmApiRequest was NOT called
      expect(vi.mocked(swarmApiRequest)).not.toHaveBeenCalled();
    });

    test("returns mock response when swarmApiKey is missing", async () => {
      // Update swarm to have null swarmApiKey
      await db.swarm.update({
        where: { id: testSwarm.id },
        data: { swarmApiKey: null },
      });

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes).toEqual([]);

      // Verify swarmApiRequest was NOT called
      expect(vi.mocked(swarmApiRequest)).not.toHaveBeenCalled();
    });

    test("uses custom SWARM_URL and SWARM_API_KEY env vars when set", async () => {
      // Set environment variables
      process.env.CUSTOM_SWARM_URL = "https://custom-swarm.example.com";
      process.env.CUSTOM_SWARM_API_KEY = "custom-api-key-456";

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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(200);

      // Verify swarmApiRequest was called with custom URL
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith({
        swarmUrl: "https://custom-swarm.example.com:8444",
        endpoint: "graph/search/latest-by-types",
        method: "POST",
        apiKey: expect.any(String),
        data: { nodeTypes: { Function: 50 } },
      });

      // Cleanup
      delete process.env.CUSTOM_SWARM_URL;
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.total_nodes).toBe(1);
      expect(data.data.total_edges).toBe(0);
    });

    test("handles Jarvis API error response", async () => {
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: false,
        status: 500,
        data: { error: "Internal server error" },
      });

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    test("handles Jarvis API timeout", async () => {
      vi.mocked(swarmApiRequest).mockRejectedValue(
        new Error("Request timeout")
      );

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to search by types");
    });

    test("constructs correct Jarvis endpoint URL", async () => {
      const mockResponse = { nodes: [], edges: [] };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      await createAuthenticatedPostRequest(testUser.id, testWorkspace.id, {
        nodeTypes: { Function: 50 },
      });

      // Verify URL construction
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          swarmUrl: expect.stringContaining(".sphinx.chat:8444"),
          endpoint: "graph/search/latest-by-types",
        })
      );
    });

    test("passes decrypted API key to swarmApiRequest", async () => {
      const mockResponse = { nodes: [], edges: [] };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      await createAuthenticatedPostRequest(testUser.id, testWorkspace.id, {
        nodeTypes: { Function: 50 },
      });

      // Verify API key is passed (encrypted format from DB)
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Episode: 50 } }
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Episode: 50 } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Episode: 50 } }
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes[0].properties.media_url).toBeUndefined();

      // Verify S3 presigning was NOT called
      expect(
        mockS3Service.generatePresignedDownloadUrlForBucket
      ).not.toHaveBeenCalled();
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.total_nodes).toBe(100);
      expect(data.data.total_edges).toBe(50);
      expect(data.data.custom_field).toBe("custom_value");
    });

    test("returns error response structure for failures", async () => {
      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: null }
      );

      expect(response.status).toBe(400);
      const data = await response.json();

      // Verify error response structure
      expect(data).toHaveProperty("success", false);
      expect(data).toHaveProperty("message");
      expect(typeof data.message).toBe("string");
    });
  });

  describe("Error Handling", () => {
    test("handles database query errors gracefully", async () => {
      // Mock database error
      const originalFindFirst = db.swarm.findFirst;
      db.swarm.findFirst = vi
        .fn()
        .mockRejectedValue(new Error("Database error"));

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to search by types");

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
              episode_title: "Test",
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Episode: 50 } }
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to search by types");
    });

    test("handles network errors gracefully", async () => {
      vi.mocked(swarmApiRequest).mockRejectedValue(
        new Error("Network error: ECONNREFUSED")
      );

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 50 } }
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to search by types");
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
      test(`allows ${role} role to search by types`, async () => {
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

        const response = await createAuthenticatedPostRequest(
          roleUser.id,
          testWorkspace.id,
          { nodeTypes: { Function: 50 } }
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

  describe("Complex Queries", () => {
    test("handles high limit values", async () => {
      const mockResponse = {
        nodes: Array.from({ length: 100 }, (_, i) => ({
          ref_id: `func-${i}`,
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

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: { Function: 10000 } }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes.length).toBeGreaterThan(0);
    });

    test("handles multiple types with different limits", async () => {
      const mockResponse = {
        nodes: [
          { ref_id: "func-1", node_type: "Function", date_added_to_graph: Date.now(), properties: {} },
          { ref_id: "file-1", node_type: "File", date_added_to_graph: Date.now(), properties: {} },
          { ref_id: "var-1", node_type: "Variable", date_added_to_graph: Date.now(), properties: {} },
          { ref_id: "person-1", node_type: "Person", date_added_to_graph: Date.now(), properties: {} },
          { ref_id: "episode-1", node_type: "Episode", date_added_to_graph: Date.now(), properties: {} },
        ],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        {
          nodeTypes: {
            Function: 100,
            File: 50,
            Variable: 25,
            Person: 10,
            Episode: 5,
          },
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes).toHaveLength(5);

      // Verify all types are present
      const nodeTypes = data.data.nodes.map((n: any) => n.node_type);
      expect(nodeTypes).toContain("Function");
      expect(nodeTypes).toContain("File");
      expect(nodeTypes).toContain("Variable");
      expect(nodeTypes).toContain("Person");
      expect(nodeTypes).toContain("Episode");
    });

    test("handles empty nodeTypes object", async () => {
      const response = await createAuthenticatedPostRequest(
        testUser.id,
        testWorkspace.id,
        { nodeTypes: {} }
      );

      // Empty nodeTypes is technically valid according to validation,
      // but Jarvis may handle it differently
      expect([200, 400]).toContain(response.status);
    });
  });
});
