import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";
import { generateUniqueId } from "@/__tests__/support/helpers";

const encryptionService = new EncryptionService();

// Mock next-auth first
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock config module to control USE_MOCKS
vi.mock("@/config/env", async () => {
  const actual = await vi.importActual("@/config/env");
  return {
    ...actual,
    config: new Proxy((actual as any).config, {
      get(target, prop) {
        if (prop === "USE_MOCKS") {
          return process.env.USE_MOCKS === "true";
        }
        return target[prop];
      },
    }),
  };
});

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

  // Helper to create authenticated GET request
  const createAuthenticatedGetRequest = async (
    userId: string,
    workspaceId: string
  ) => {
    const { GET } = await import("@/app/api/swarm/jarvis/nodes/route");
    const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspaceId}`;

    // Mock NextAuth session
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: userId, email: testUser.email, name: testUser.name },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    const request = new NextRequest(url, {
      method: "GET",
    });

    return GET(request as any);
  };

  // Helper to create unauthenticated GET request
  const createUnauthenticatedGetRequest = async (workspaceId: string) => {
    const { GET } = await import("@/app/api/swarm/jarvis/nodes/route");
    const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${workspaceId}`;

    // Mock no session
    vi.mocked(getServerSession).mockResolvedValue(null);

    const request = new NextRequest(url, {
      method: "GET",
    });

    return GET(request as any);
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test user
    const uniqueId = generateUniqueId();
    testUser = await db.user.create({
      data: {
        id: `user-${uniqueId}`,
        email: `test-${uniqueId}@example.com`,
        name: `Test User ${uniqueId}`,
        emailVerified: new Date(),
      },
    });

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        name: `Test Workspace ${uniqueId}`,
        slug: `test-workspace-${uniqueId}`,
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
        name: `test-swarm-${uniqueId}`,
        swarmUrl: `https://test-swarm-${uniqueId}.sphinx.chat:8444`,
        swarmApiKey: JSON.stringify(encryptedApiKey),
        workspaceId: testWorkspace.id,
      },
    });

    // Setup default S3 service mock
    const mockS3Service = {
      generatePresignedDownloadUrlForBucket: vi
        .fn()
        .mockResolvedValue(
          "https://presigned-url.example.com/media.mp4?signature=xyz"
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
      const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${testWorkspace.id}`;

      // Mock session without user id
      vi.mocked(getServerSession).mockResolvedValue({
        user: { email: testUser.email },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      } as any);

      const request = new NextRequest(url, {
        method: "GET",
      });

      const response = await GET(request as any);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });
  });

  describe("Authorization", () => {
    const roles: WorkspaceRole[] = [
      "OWNER",
      "ADMIN",
      "PM",
      "DEVELOPER",
      "VIEWER",
    ];

    roles.forEach((role) => {
      test(`allows ${role} to access jarvis nodes`, async () => {
        // Update member role
        await db.workspaceMember.update({
          where: {
            workspaceId_userId: {
              workspaceId: testWorkspace.id,
              userId: testUser.id,
            },
          },
          data: { role },
        });

        // Mock successful Jarvis API response
        vi.mocked(swarmApiRequest).mockResolvedValue({
          ok: true,
          status: 200,
          data: {
            nodes: [
              {
                ref_id: "node-1",
                name: "Test Node",
                label: "TestLabel",
                node_type: "Feature",
              },
            ],
            edges: [],
          },
        });

        const response = await createAuthenticatedGetRequest(
          testUser.id,
          testWorkspace.id
        );

        expect(response.status).toBe(200);
      });
    });
  });

  describe("Happy Path", () => {
    test("successfully retrieves jarvis nodes with valid swarm config", async () => {
      // Temporarily disable USE_MOCKS for this test
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";
      vi.resetModules();

      const mockResponse = {
        nodes: [
          {
            ref_id: "node-1",
            name: "Feature Node",
            label: "FeatureLabel",
            node_type: "Feature",
            properties: { description: "Test feature" },
          },
          {
            ref_id: "node-2",
            name: "Task Node",
            label: "TaskLabel",
            node_type: "Task",
            properties: { status: "TODO" },
          },
        ],
        edges: [
          {
            ref_id: "edge-1",
            edge_type: "DEPENDS_ON",
            source: "node-1",
            target: "node-2",
          },
        ],
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
      expect(data.data.nodes).toHaveLength(2);
      expect(data.data.edges).toHaveLength(1);
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          swarmUrl: expect.stringContaining(testSwarm.name),
          endpoint: expect.stringContaining("graph/search/latest"),
          method: "GET",
          apiKey: expect.any(String),
        })
      );

      // Restore
      process.env.USE_MOCKS = originalUseMocks;
      vi.resetModules();
    });

    test("handles complex graph structures with multiple nodes and edges", async () => {
      // Temporarily disable USE_MOCKS for this test
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";
      vi.resetModules();

      const complexGraph = {
        nodes: Array.from({ length: 10 }, (_, i) => ({
          ref_id: `node-${i}`,
          name: `Node ${i}`,
          label: `Label${i}`,
          node_type: i % 2 === 0 ? "Feature" : "Task",
          properties: { index: i },
        })),
        edges: Array.from({ length: 15 }, (_, i) => ({
          ref_id: `edge-${i}`,
          edge_type: "RELATES_TO",
          source: `node-${i % 10}`,
          target: `node-${(i + 1) % 10}`,
        })),
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: complexGraph,
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nodes).toHaveLength(10);
      expect(data.data.edges).toHaveLength(15);
      expect(data.data.nodes.every((node: any) => node.ref_id)).toBe(true);
      expect(
        data.data.edges.every((edge: any) => edge.source && edge.target)
      ).toBe(true);

      // Restore
      process.env.USE_MOCKS = originalUseMocks;
      vi.resetModules();
    });

    test("passes custom endpoint parameter to Jarvis API", async () => {
      // Temporarily disable USE_MOCKS for this test
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";
      vi.resetModules();

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [], edges: [] },
      });

      const { GET } = await import("@/app/api/swarm/jarvis/nodes/route");
      const customEndpoint = "/api/custom_graph";
      const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${testWorkspace.id}&endpoint=${encodeURIComponent(customEndpoint)}`;

      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const request = new NextRequest(url, { method: "GET" });
      await GET(request as any);

      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: customEndpoint,
          method: "GET",
        })
      );

      // Restore
      process.env.USE_MOCKS = originalUseMocks;
      vi.resetModules();
    });

    test("filters nodes by node_type parameter", async () => {
      // Temporarily disable USE_MOCKS for this test
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";
      vi.resetModules();

      const mockResponse = {
        nodes: [
          {
            ref_id: "node-1",
            name: "Feature Node",
            node_type: "Feature",
          },
        ],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: mockResponse,
      });

      const { GET } = await import("@/app/api/swarm/jarvis/nodes/route");
      const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${testWorkspace.id}&node_type=Feature`;

      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const request = new NextRequest(url, { method: "GET" });
      const response = await GET(request as any);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nodes).toHaveLength(1);
      expect(data.data.nodes[0].node_type).toBe("Feature");
      
      // Verify node_type was included in the endpoint
      expect(vi.mocked(swarmApiRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: expect.stringContaining("node_type=Feature"),
          method: "GET",
        })
      );

      // Restore
      process.env.USE_MOCKS = originalUseMocks;
      vi.resetModules();
    });
  });

  describe("Media URL Presigning", () => {
    test("generates presigned URLs for nodes with media_url properties", async () => {
      // Temporarily disable USE_MOCKS for this test
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";
      vi.resetModules();
      const mockPresignedUrl =
        "https://presigned.s3.amazonaws.com/media.mp4?signature=xyz";
      const mockS3Service = {
        generatePresignedDownloadUrlForBucket: vi
          .fn()
          .mockResolvedValue(mockPresignedUrl),
      };
      vi.mocked(getS3Service).mockReturnValue(mockS3Service as any);

      const mockResponse = {
        nodes: [
          {
            ref_id: "node-1",
            name: "Video Node",
            node_type: "Media",
            properties: {
              media_url:
                "https://sphinx-livekit-recordings.s3.amazonaws.com/test-key.mp4",
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
      expect(mockS3Service.generatePresignedDownloadUrlForBucket).toHaveBeenCalledWith(
        "sphinx-livekit-recordings",
        "test-key.mp4",
        3600
      );
      expect(data.data.nodes[0].properties.media_url).toBe(mockPresignedUrl);

      // Restore
      process.env.USE_MOCKS = originalUseMocks;
      vi.resetModules();
    });

    test("handles multiple nodes with media_url properties", async () => {
      // Temporarily disable USE_MOCKS for this test
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";
      vi.resetModules();

      const mockPresignedUrls = [
        "https://presigned.s3.amazonaws.com/media1.mp4?sig=1",
        "https://presigned.s3.amazonaws.com/media2.mp4?sig=2",
      ];

      const mockS3Service = {
        generatePresignedDownloadUrlForBucket: vi
          .fn()
          .mockResolvedValueOnce(mockPresignedUrls[0])
          .mockResolvedValueOnce(mockPresignedUrls[1]),
      };
      vi.mocked(getS3Service).mockReturnValue(mockS3Service as any);

      const mockResponse = {
        nodes: [
          {
            ref_id: "node-1",
            name: "Video Node 1",
            properties: {
              media_url:
                "https://sphinx-livekit-recordings.s3.amazonaws.com/key1.mp4",
            },
          },
          {
            ref_id: "node-2",
            name: "Video Node 2",
            properties: {
              media_url:
                "https://sphinx-livekit-recordings.s3.amazonaws.com/key2.mp4",
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
      expect(mockS3Service.generatePresignedDownloadUrlForBucket).toHaveBeenCalledTimes(2);
      expect(data.data.nodes[0].properties.media_url).toBe(mockPresignedUrls[0]);
      expect(data.data.nodes[1].properties.media_url).toBe(mockPresignedUrls[1]);

      // Restore
      process.env.USE_MOCKS = originalUseMocks;
      vi.resetModules();
    });

    test("preserves original URL when presigning fails", async () => {
      // Temporarily disable USE_MOCKS for this test
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";
      vi.resetModules();

      const originalUrl =
        "https://sphinx-livekit-recordings.s3.amazonaws.com/test-key.mp4";
      
      const mockS3Service = {
        generatePresignedDownloadUrlForBucket: vi
          .fn()
          .mockRejectedValue(new Error("S3 error")),
      };
      vi.mocked(getS3Service).mockReturnValue(mockS3Service as any);

      const mockResponse = {
        nodes: [
          {
            ref_id: "node-1",
            name: "Video Node",
            properties: { media_url: originalUrl },
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
      expect(data.data.nodes[0].properties.media_url).toBe(originalUrl);

      // Restore
      process.env.USE_MOCKS = originalUseMocks;
      vi.resetModules();
    });

    test("does not process nodes without media_url properties", async () => {
      // Temporarily disable USE_MOCKS for this test
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";
      vi.resetModules();

      const mockS3Service = {
        generatePresignedDownloadUrlForBucket: vi.fn(),
      };
      vi.mocked(getS3Service).mockReturnValue(mockS3Service as any);

      const mockResponse = {
        nodes: [
          {
            ref_id: "node-1",
            name: "Regular Node",
            properties: { description: "No media" },
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
      expect(mockS3Service.generatePresignedDownloadUrlForBucket).not.toHaveBeenCalled();

      // Restore
      process.env.USE_MOCKS = originalUseMocks;
      vi.resetModules();
    });
  });

  describe("Error Scenarios", () => {
    test("returns 404 when workspace is not found", async () => {
      const nonExistentId = "non-existent-workspace-id";
      
      const response = await createAuthenticatedGetRequest(
        testUser.id,
        nonExistentId
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Workspace not found");
    });

    test("falls back to mock endpoint when swarm is not configured", async () => {
      // Delete the swarm (endpoint will fall back to mock API)
      await db.swarm.deleteMany({ where: { workspaceId: testWorkspace.id } });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      // Response structure is { success, data: { nodes, edges } }
      expect(data.success).toBe(true);
      expect(data.data.nodes).toBeDefined();
      expect(data.data.nodes.length).toBeGreaterThan(0);
    });

    test("falls back to mock data when Jarvis API returns errors", async () => {
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: false,
        status: 500,
        data: { error: "Internal server error" },
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes).toBeDefined();
      expect(data.data.nodes.length).toBeGreaterThan(0);
    });

    test("handles network errors when calling Jarvis API", async () => {
      // Temporarily disable USE_MOCKS for this test
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";
      vi.resetModules();

      vi.mocked(swarmApiRequest).mockRejectedValue(new Error("Network error"));

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Failed to get nodes");

      // Restore
      process.env.USE_MOCKS = originalUseMocks;
      vi.resetModules();
    });
  });

  describe("Mock Fallback Behavior", () => {
    test("returns mock data when USE_MOCKS=true (skips swarm lookup)", async () => {
      // Set USE_MOCKS to true
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "true";

      // Need to reload the modules to pick up env change
      vi.resetModules();

      // Re-import after resetting modules
      const { GET } = await import("@/app/api/swarm/jarvis/nodes/route");
      const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${testWorkspace.id}`;

      // Mock NextAuth session
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const request = new NextRequest(url, {
        method: "GET",
      });

      // Don't mock swarmApiRequest - it should never be called
      const swarmApiSpy = vi.mocked(swarmApiRequest);
      swarmApiSpy.mockClear();

      const response = await GET(request as any);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes).toBeDefined();
      expect(data.data.nodes.length).toBeGreaterThan(0);

      // Verify swarm API was never called
      expect(swarmApiSpy).not.toHaveBeenCalled();

      // Cleanup
      if (originalUseMocks !== undefined) {
        process.env.USE_MOCKS = originalUseMocks;
      } else {
        delete process.env.USE_MOCKS;
      }
      vi.resetModules();
    });

    test("falls back to mock data when swarmApiRequest returns ok: false", async () => {
      // Ensure USE_MOCKS is false so swarm API is attempted
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";

      // Clear and mock swarm API failure
      vi.mocked(swarmApiRequest).mockClear();
      vi.mocked(swarmApiRequest).mockResolvedValue({
        ok: false,
        status: 503,
        data: undefined,
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nodes).toBeDefined();
      expect(data.data.nodes.length).toBeGreaterThan(0);

      // The test verifies that when swarm API returns ok: false,
      // the endpoint falls back to mock data (status 200, success true, nodes present)
      // This proves the fallback logic works correctly

      // Cleanup
      if (originalUseMocks !== undefined) {
        process.env.USE_MOCKS = originalUseMocks;
      } else {
        delete process.env.USE_MOCKS;
      }
    });

    test.each([
      [500, "Internal Server Error"],
      [503, "Service Unavailable"],
      [404, "Not Found"],
    ])(
      "falls back to mock data when swarm API returns status %i",
      async (status, description) => {
        // Ensure USE_MOCKS is false so swarm API is attempted
        const originalUseMocks = process.env.USE_MOCKS;
        process.env.USE_MOCKS = "false";

        vi.mocked(swarmApiRequest).mockResolvedValue({
          ok: false,
          status,
          data: { error: description },
        });

        const response = await createAuthenticatedGetRequest(
          testUser.id,
          testWorkspace.id
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.nodes).toBeDefined();

        // Cleanup
        if (originalUseMocks !== undefined) {
          process.env.USE_MOCKS = originalUseMocks;
        } else {
          delete process.env.USE_MOCKS;
        }
      }
    );
  });

  describe("Edge Cases", () => {
    test("handles empty nodes and edges arrays", async () => {
      // Temporarily disable USE_MOCKS for this test
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";
      vi.resetModules();

      vi.mocked(swarmApiRequest).mockResolvedValueOnce({
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
      expect(data.data.nodes).toEqual([]);
      expect(data.data.edges).toEqual([]);

      // Restore
      process.env.USE_MOCKS = originalUseMocks;
      vi.resetModules();
    });

    test("handles nodes with missing properties", async () => {
      // Temporarily disable USE_MOCKS for this test
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";
      vi.resetModules();

      const mockResponse = {
        nodes: [
          {
            ref_id: "node-1",
            name: "Minimal Node",
            // No properties field
          },
        ],
        edges: [],
      };

      vi.mocked(swarmApiRequest).mockResolvedValueOnce({
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
      expect(data.data.nodes[0]).not.toHaveProperty("properties");

      // Restore
      process.env.USE_MOCKS = originalUseMocks;
      vi.resetModules();
    });

    test("handles very large graph structures", async () => {
      // Temporarily disable USE_MOCKS for this test
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";
      vi.resetModules();

      const largeGraph = {
        nodes: Array.from({ length: 1000 }, (_, i) => ({
          ref_id: `node-${i}`,
          name: `Node ${i}`,
          node_type: "Feature",
        })),
        edges: Array.from({ length: 2000 }, (_, i) => ({
          ref_id: `edge-${i}`,
          source: `node-${i % 1000}`,
          target: `node-${(i + 1) % 1000}`,
        })),
      };

      vi.mocked(swarmApiRequest).mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: largeGraph,
      });

      const response = await createAuthenticatedGetRequest(
        testUser.id,
        testWorkspace.id
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nodes).toHaveLength(1000);
      expect(data.data.edges).toHaveLength(2000);

      // Restore
      process.env.USE_MOCKS = originalUseMocks;
      vi.resetModules();
    });
  });
});
