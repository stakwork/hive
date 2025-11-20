import { describe, test, beforeEach, vi, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/swarm/jarvis/nodes/route";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { getS3Service } from "@/services/s3";
import { EncryptionService } from "@/lib/encryption";
import {
  createTestUser,
  createTestWorkspace,
  resetDatabase,
} from "@/__tests__/support/fixtures";
import type { JarvisResponse, JarvisNode } from "@/types/jarvis";

// Mock external services (NOT database or encryption)
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/services/swarm/api/swarm", () => ({
  swarmApiRequest: vi.fn(),
}));

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(),
}));

// Mock global fetch for mock endpoint calls
global.fetch = vi.fn();

describe("GET /api/swarm/jarvis/nodes - Integration Tests", () => {
  const endpointUrl = "http://localhost:3000/api/swarm/jarvis/nodes";
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase();

    // Create test user and workspace for each test
    testUser = await createTestUser({
      email: "test@example.com",
      name: "Test User",
    });

    testWorkspace = await createTestWorkspace({
      name: "Test Workspace",
      slug: "test-workspace",
      ownerId: testUser.id,
    });

    // Setup default S3 service mock
    const mockS3Service = {
      getPresignedUrl: vi.fn((url: string) => Promise.resolve(`presigned-${url}`)),
      generatePresignedDownloadUrl: vi.fn((key: string) => Promise.resolve(`presigned-${key}`)),
      generatePresignedDownloadUrlForBucket: vi.fn((bucket: string, key: string) => 
        Promise.resolve(`presigned-${bucket}-${key}`)
      ),
    };
    vi.mocked(getS3Service).mockReturnValue(mockS3Service as any);
  });

  // ==========================================
  // 1. AUTHENTICATION & AUTHORIZATION TESTS
  // ==========================================

  describe("Authentication & Authorization", () => {
    test("returns 401 for unauthenticated requests", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    test("returns 401 when session has no user", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    test("returns 401 when session has no user id", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { email: "test@example.com", name: "Test User" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    test("allows authenticated users to fetch nodes", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);

      // Mock workspace without swarm (will call mock endpoint)
      const mockResponse = {
        success: true,
        status: 200,
        data: { nodes: [], edges: [] },
      };

      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  // ==========================================
  // 2. QUERY PARAMETERS VALIDATION TESTS
  // ==========================================

  describe("Query Parameters Validation", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);
    });

    test("handles requests without workspace id", async () => {
      // Mock workspace without swarm (will call mock endpoint with empty slug)
      const request = new NextRequest(endpointUrl, { method: "GET" });

      const mockResponse = {
        success: true,
        status: 200,
        data: { nodes: [], edges: [] },
      };

      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const response = await GET(request);
      
      // Should fail when trying to get workspace slug
      expect(response.status).toBe(404);
    });

    test("uses default endpoint when not provided", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const mockJarvisResponse: JarvisResponse = {
        nodes: [],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      await GET(request);

      expect(swarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "graph/search/latest?limit=1000&top_node_count=500",
        })
      );
    });

    test("uses custom endpoint when provided", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const customEndpoint = "graph/custom?filter=test";
      const mockJarvisResponse: JarvisResponse = {
        nodes: [],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}&endpoint=${encodeURIComponent(customEndpoint)}`,
        { method: "GET" }
      );

      await GET(request);

      expect(swarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: customEndpoint,
        })
      );
    });

    test("appends node_type to endpoint when provided", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const mockJarvisResponse: JarvisResponse = {
        nodes: [],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}&node_type=Function`,
        { method: "GET" }
      );

      await GET(request);

      expect(swarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "graph/search/latest?limit=1000&top_node_count=500&node_type=Function",
        })
      );
    });

    test("appends node_type to custom endpoint with existing query params", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const mockJarvisResponse: JarvisResponse = {
        nodes: [],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      const customEndpoint = "graph/search?filter=test";
      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}&endpoint=${encodeURIComponent(customEndpoint)}&node_type=endpoint`,
        { method: "GET" }
      );

      await GET(request);

      expect(swarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "graph/search?filter=test&node_type=endpoint",
        })
      );
    });
  });

  // ==========================================
  // 3. SWARM CONFIGURATION HANDLING TESTS
  // ==========================================

  describe("Swarm Configuration Handling", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);
    });

    test("redirects to mock endpoint when swarm not configured", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        data: { nodes: [], edges: [] },
      };

      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/mock/jarvis/graph"),
        expect.anything()
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(`workspaceSlug=${testWorkspace.slug}`),
        expect.anything()
      );
    });

    test("redirects to mock endpoint when swarmUrl is null", async () => {
      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: null,
          swarmApiKey: null,
          status: "PENDING",
        },
      });

      const mockResponse = {
        success: true,
        status: 200,
        data: { nodes: [], edges: [] },
      };

      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/mock/jarvis/graph"),
        expect.anything()
      );
    });

    test("redirects to mock endpoint when swarmApiKey is null", async () => {
      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: null,
          status: "PENDING",
        },
      });

      const mockResponse = {
        success: true,
        status: 200,
        data: { nodes: [], edges: [] },
      };

      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/mock/jarvis/graph"),
        expect.anything()
      );
    });

    test("constructs correct Jarvis URL with vanityAddress:8444", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const mockJarvisResponse: JarvisResponse = {
        nodes: [],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      await GET(request);

      expect(swarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          swarmUrl: expect.stringContaining(":8444"),
        })
      );
    });

    test("uses encrypted API key from database", async () => {
      const encryptionService = EncryptionService.getInstance();
      const plainApiKey = "test-api-key-12345";
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        plainApiKey
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const mockJarvisResponse: JarvisResponse = {
        nodes: [],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      await GET(request);

      expect(swarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: JSON.stringify(encryptedApiKey),
        })
      );
    });

    test("returns 404 when workspace not found for mock fallback", async () => {
      const nonExistentWorkspaceId = "non-existent-workspace-id";

      const request = new NextRequest(
        `${endpointUrl}?id=${nonExistentWorkspaceId}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Workspace not found");
    });
  });

  // ==========================================
  // 4. API INTEGRATION WITH JARVIS SERVICE
  // ==========================================

  describe("API Integration with Jarvis Service", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);
    });

    test("calls swarmApiRequest with correct parameters", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const mockJarvisResponse: JarvisResponse = {
        nodes: [],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      await GET(request);

      expect(swarmApiRequest).toHaveBeenCalledTimes(1);
      expect(swarmApiRequest).toHaveBeenCalledWith({
        swarmUrl: expect.stringContaining(":8444"),
        endpoint: "graph/search/latest?limit=1000&top_node_count=500",
        method: "GET",
        apiKey: JSON.stringify(encryptedApiKey),
      });
    });

    test("returns 503 on Jarvis API failure", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: false,
        status: 503,
        data: { nodes: [], edges: [] }, // Provide valid structure even on error
      });

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
    });

    test("returns 500 on general exception", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      vi.mocked(swarmApiRequest).mockRejectedValue(
        new Error("Network timeout")
      );

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to get nodes");
    });

    test("handles successful Jarvis API response", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const mockNodes: JarvisNode[] = [
        {
          ref_id: "node-1",
          node_type: "Function",
          properties: { name: "testFunction" },
        },
        {
          ref_id: "node-2",
          node_type: "Variable",
          properties: { name: "testVariable" },
        },
      ];

      const mockJarvisResponse: JarvisResponse = {
        nodes: mockNodes,
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.nodes).toHaveLength(2);
      expect(data.data.nodes[0].ref_id).toBe("node-1");
      expect(data.data.nodes[1].ref_id).toBe("node-2");
    });
  });

  // ==========================================
  // 5. DATA PROCESSING & TRANSFORMATION TESTS
  // ==========================================

  describe("Data Processing & Transformation", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);
    });

    test("processes media URLs via S3 presigned URLs", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const mockNodes: JarvisNode[] = [
        {
          ref_id: "node-1",
          node_type: "Episode",
          properties: {
            media_url: "https://s3.amazonaws.com/sphinx-livekit-recordings/video.mp4",
          },
        },
      ];

      const mockJarvisResponse: JarvisResponse = {
        nodes: mockNodes,
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.nodes[0].properties.media_url).toContain("presigned-");
      expect(getS3Service).toHaveBeenCalled();
    });

    test("converts timestamps from milliseconds to seconds", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const millisecondTimestamp = 1704067200000; // 13 digits (milliseconds)
      const expectedSecondTimestamp = 1704067200; // 10 digits (seconds)

      const mockNodes: JarvisNode[] = [
        {
          ref_id: "node-1",
          node_type: "Function",
          date_added_to_graph: millisecondTimestamp,
        },
      ];

      const mockJarvisResponse: JarvisResponse = {
        nodes: mockNodes,
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.nodes[0].date_added_to_graph).toBe(expectedSecondTimestamp);
    });

    test("preserves timestamps already in seconds", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const secondTimestamp = 1704067200; // 10 digits (already seconds)

      const mockNodes: JarvisNode[] = [
        {
          ref_id: "node-1",
          node_type: "Function",
          date_added_to_graph: secondTimestamp,
        },
      ];

      const mockJarvisResponse: JarvisResponse = {
        nodes: mockNodes,
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.nodes[0].date_added_to_graph).toBe(secondTimestamp);
    });

    test("returns correct JarvisResponse structure", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const mockNodes: JarvisNode[] = [
        {
          ref_id: "node-1",
          node_type: "Function",
          properties: { name: "testFunction" },
        },
      ];

      const mockEdges = [
        { source: "node-1", target: "node-2", type: "calls" },
      ];

      const mockJarvisResponse: JarvisResponse = {
        nodes: mockNodes,
        edges: mockEdges,
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        success: true,
        status: 200,
        data: {
          nodes: expect.any(Array),
          edges: expect.any(Array),
        },
      });
      expect(data.data.nodes).toHaveLength(1);
      expect(data.data.edges).toHaveLength(1);
    });

    test("handles nodes without date_added_to_graph field", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const mockNodes: JarvisNode[] = [
        {
          ref_id: "node-1",
          node_type: "Function",
          properties: { name: "testFunction" },
        },
      ];

      const mockJarvisResponse: JarvisResponse = {
        nodes: mockNodes,
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.nodes[0]).toBeDefined();
    });

    test("continues with original data if media URL processing fails", async () => {
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key"
      );

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test.swarm.local",
          swarmApiKey: JSON.stringify(encryptedApiKey),
          status: "ACTIVE",
        },
      });

      const mockNodes: JarvisNode[] = [
        {
          ref_id: "node-1",
          node_type: "Episode",
          properties: {
            media_url: "https://s3.amazonaws.com/bucket/video.mp4",
          },
        },
      ];

      const mockJarvisResponse: JarvisResponse = {
        nodes: mockNodes,
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        data: mockJarvisResponse,
        status: 200,
      });

      // Mock S3 service to throw error
      const mockS3Service = {
        getPresignedUrl: vi.fn(() => {
          throw new Error("S3 error");
        }),
      };
      vi.mocked(getS3Service).mockReturnValue(mockS3Service as any);

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      // Should still return 200 with original data
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.nodes[0].ref_id).toBe("node-1");
    });
  });

  // ==========================================
  // 6. MOCK ENDPOINT FALLBACK TESTS
  // ==========================================

  describe("Mock Endpoint Fallback", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);
    });

    test("mock endpoint returns sample nodes for testing", async () => {
      const mockNodes: JarvisNode[] = [
        {
          ref_id: "mock-node-1",
          node_type: "Function",
          properties: { name: "mockFunction" },
        },
        {
          ref_id: "mock-node-2",
          node_type: "Variable",
          properties: { name: "mockVariable" },
        },
      ];

      const mockResponse = {
        success: true,
        status: 200,
        data: { nodes: mockNodes, edges: [] },
      };

      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.nodes).toHaveLength(2);
      expect(data.data.nodes[0].ref_id).toBe("mock-node-1");
      expect(data.data.nodes[1].ref_id).toBe("mock-node-2");
    });

    test("returns error from mock endpoint when it fails", async () => {
      const mockErrorResponse = {
        success: false,
        message: "Mock endpoint error",
      };

      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockErrorResponse), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        { method: "GET" }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Mock endpoint error");
    });

    test("forwards request cookies to mock endpoint", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        data: { nodes: [], edges: [] },
      };

      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = new NextRequest(
        `${endpointUrl}?id=${testWorkspace.id}`,
        {
          method: "GET",
          headers: {
            Cookie: "session-token=abc123",
          },
        }
      );

      await GET(request);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/mock/jarvis/graph"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Cookie: "session-token=abc123",
          }),
        })
      );
    });
  });
});