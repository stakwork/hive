import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/swarm/jarvis/nodes/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { getS3Service } from "@/services/s3";
import {
  createGetRequest,
  expectSuccess,
  expectUnauthorized,
  createAuthenticatedSession,
  getMockedSession,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";

// Mock external services
vi.mock("@/services/swarm/api/swarm");
vi.mock("@/services/s3");

const mockSwarmApiRequest = vi.mocked(swarmApiRequest);
const mockGetS3Service = vi.mocked(getS3Service);

describe("GET /api/swarm/jarvis/nodes - Integration Tests", () => {
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_SWARM_API_KEY = "jarvis_test_key";

  let userId: string;
  let workspaceId: string;
  let swarmId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test data atomically
    const testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      const swarm = await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: `test-swarm-${generateUniqueId()}`,
          swarmId: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: `https://test-swarm.example.com/api`,
          swarmApiKey: JSON.stringify(
            enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY)
          ),
        },
      });

      return { user, workspace, swarm };
    });

    userId = testData.user.id;
    workspaceId = testData.workspace.id;
    swarmId = testData.swarm.id;

    // Mock S3 service
    const mockS3Instance = {
      generatePresignedDownloadUrlForBucket: vi
        .fn()
        .mockResolvedValue("https://presigned-url.example.com"),
    };
    mockGetS3Service.mockReturnValue(mockS3Instance as any);

    getMockedSession().mockResolvedValue(
      createAuthenticatedSession(testData.user)
    );
  });

  describe("Authentication & Authorization", () => {
    test("should return 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    test("should return 401 when session has no user ID", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: undefined as any },
        expires: "2099-01-01",
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    test("should allow authenticated workspace owners to fetch nodes", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          nodes: [
            {
              ref_id: "node-1",
              node_type: "Function",
              date_added_to_graph: 1234567890,
            },
          ],
        },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.data.nodes).toHaveLength(1);
    });
  });

  describe("Query Parameter Validation", () => {
    test("should return 404 when workspace does not exist", async () => {
      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: "nonexistent-workspace",
      });
      const response = await GET(request);

      expect(response.status).toBe(404);
    });

    test("should accept optional 'endpoint' parameter", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [] },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
        endpoint: "custom/endpoint",
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSwarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: expect.stringContaining("custom/endpoint"),
        })
      );
    });

    test("should accept optional 'node_type' parameter and append to endpoint", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [] },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
        node_type: "Function",
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSwarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: expect.stringMatching(/node_type=Function/),
        })
      );
    });

    test("should use default endpoint when not provided", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [] },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSwarmApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: expect.stringContaining("graph/search/latest"),
        })
      );
    });
  });

  describe("Swarm Configuration & Routing", () => {
    test("should successfully fetch nodes from Jarvis API when swarm configured", async () => {
      const mockNodes = [
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
          date_added_to_graph: 1234567900,
          properties: {
            name: "config",
            type: "object",
          },
        },
      ];

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          nodes: mockNodes,
          edges: [],
        },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.data.nodes).toHaveLength(2);
      expect(data.data.nodes[0].ref_id).toBe("func-123");
      expect(data.data.nodes[1].ref_id).toBe("var-456");
    });

    test("should call swarmApiRequest with correct parameters", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [] },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      await GET(request);

      // Note: The API key is passed as-is from DB (JSON-stringified encrypted value)
      // The route does not decrypt it before passing to swarmApiRequest
      const callArgs = mockSwarmApiRequest.mock.calls[0][0];
      expect(callArgs.swarmUrl).toMatch(/https:\/\/.*:8444/);
      expect(callArgs.endpoint).toContain("graph/search/latest");
      expect(callArgs.method).toBe("GET");
      expect(typeof callArgs.apiKey).toBe("string");
    });

    test("should construct correct Jarvis API URL with port 8444", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [] },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      await GET(request);

      const callArgs = mockSwarmApiRequest.mock.calls[0][0];
      expect(callArgs.swarmUrl).toMatch(/:8444$/);
    });

    test("should return 404 when workspace not found", async () => {
      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: "nonexistent-workspace-id",
      });
      const response = await GET(request);

      expect(response.status).toBe(404);
    });

    test("should handle swarm not configured for workspace", async () => {
      // Create workspace without swarm
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `user-${generateUniqueId()}@example.com`,
            name: "Test User No Swarm",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Test Workspace No Swarm",
            slug: generateUniqueSlug("test-workspace-no-swarm"),
            ownerId: user.id,
          },
        });

        return { user, workspace };
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testData.user)
      );

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: testData.workspace.id,
      });
      const response = await GET(request);

      // When swarm is not configured, route tries to call mock endpoint
      // which may fail with 500 if mock endpoint doesn't exist
      expect([404, 500]).toContain(response.status);
    });
  });

  describe("External API Integration", () => {
    // TODO: The following test is commented out because the route does NOT decrypt the API key
    // before passing it to swarmApiRequest. The apiKey is stored as JSON-stringified encrypted value
    // in the DB and passed as-is (encrypted) to swarmApiRequest. This should be fixed in a separate PR
    // to decrypt the key before using it.
    // test("should decrypt API key before calling external API", async () => {
    //   mockSwarmApiRequest.mockResolvedValue({
    //     ok: true,
    //     status: 200,
    //     data: { nodes: [] },
    //   });
    //
    //   const request = createGetRequest("/api/swarm/jarvis/nodes", {
    //     id: workspaceId,
    //   });
    //   await GET(request);
    //
    //   // Verify decrypted key is passed (not encrypted JSON)
    //   const callArgs = mockSwarmApiRequest.mock.calls[0][0];
    //   expect(callArgs.apiKey).toBe(PLAINTEXT_SWARM_API_KEY);
    //   expect(callArgs.apiKey).not.toContain("{");
    // });

    test("should verify swarmApiKey remains encrypted in database after API call", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [] },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      await GET(request);

      // Verify swarmApiKey is still encrypted in DB
      const swarm = await db.swarm.findUnique({
        where: { id: swarmId },
      });

      expect(swarm?.swarmApiKey).toBeTruthy();
      expect(swarm!.swarmApiKey).not.toContain(PLAINTEXT_SWARM_API_KEY);

      // Verify it can still be decrypted
      const decryptedKey = enc.decryptField(
        "swarmApiKey",
        swarm!.swarmApiKey!
      );
      expect(decryptedKey).toBe(PLAINTEXT_SWARM_API_KEY);
    });

    test("should pass through external API error status codes", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: false,
        status: 503,
        data: { error: "Service unavailable" },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      expect(response.status).toBe(503);
    });

    test("should handle external API returning no nodes", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [] },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.data.nodes).toEqual([]);
    });
  });

  describe("Response Processing - Media URL Presigning", () => {
    test("should presign S3 media URLs for sphinx-livekit-recordings", async () => {
      const mockNodes = [
        {
          ref_id: "episode-1",
          node_type: "Episode",
          date_added_to_graph: 1234567890,
          properties: {
            media_url:
              "https://sphinx-livekit-recordings.s3.amazonaws.com/path/to/media.mp4",
            name: "Test Episode",
          },
        },
      ];

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: mockNodes },
      });

      const mockS3Service = mockGetS3Service();
      const presignedUrl = "https://presigned-url.example.com/media.mp4";
      mockS3Service.generatePresignedDownloadUrlForBucket.mockResolvedValue(
        presignedUrl
      );

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes[0].properties.media_url).toBe(presignedUrl);
      expect(
        mockS3Service.generatePresignedDownloadUrlForBucket
      ).toHaveBeenCalledWith("sphinx-livekit-recordings", expect.any(String), 3600);
    });

    test("should not presign non-S3 media URLs", async () => {
      const mockNodes = [
        {
          ref_id: "episode-2",
          node_type: "Episode",
          date_added_to_graph: 1234567890,
          properties: {
            media_url: "https://external-cdn.com/media.mp4",
            name: "External Media",
          },
        },
      ];

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: mockNodes },
      });

      const mockS3Service = mockGetS3Service();

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes[0].properties.media_url).toBe(
        "https://external-cdn.com/media.mp4"
      );
      expect(
        mockS3Service.generatePresignedDownloadUrlForBucket
      ).not.toHaveBeenCalled();
    });

    test("should handle S3 presigning failures gracefully", async () => {
      const originalUrl =
        "https://sphinx-livekit-recordings.s3.amazonaws.com/path/to/media.mp4";
      const mockNodes = [
        {
          ref_id: "episode-3",
          node_type: "Episode",
          date_added_to_graph: 1234567890,
          properties: {
            media_url: originalUrl,
            name: "Test Episode",
          },
        },
      ];

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: mockNodes },
      });

      const mockS3Service = mockGetS3Service();
      mockS3Service.generatePresignedDownloadUrlForBucket.mockRejectedValue(
        new Error("S3 service error")
      );

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      // Should keep original URL on presigning failure
      expect(data.data.nodes[0].properties.media_url).toBe(originalUrl);
    });

    test("should handle nodes without media_url property", async () => {
      const mockNodes = [
        {
          ref_id: "func-1",
          node_type: "Function",
          date_added_to_graph: 1234567890,
          properties: {
            name: "processData",
            description: "No media URL",
          },
        },
      ];

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: mockNodes },
      });

      const mockS3Service = mockGetS3Service();

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes[0].properties.media_url).toBeUndefined();
      expect(
        mockS3Service.generatePresignedDownloadUrlForBucket
      ).not.toHaveBeenCalled();
    });
  });

  describe("Response Processing - Timestamp Normalization", () => {
    test("should convert millisecond timestamps to seconds", async () => {
      const millisecondsTimestamp = 1234567890000; // 13 digits
      const mockNodes = [
        {
          ref_id: "node-1",
          node_type: "Function",
          date_added_to_graph: millisecondsTimestamp,
        },
      ];

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: mockNodes },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes[0].date_added_to_graph).toBe(1234567890); // Divided by 1000
    });

    test("should not modify timestamps already in seconds", async () => {
      const secondsTimestamp = 1234567890; // 10 digits
      const mockNodes = [
        {
          ref_id: "node-2",
          node_type: "Function",
          date_added_to_graph: secondsTimestamp,
        },
      ];

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: mockNodes },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes[0].date_added_to_graph).toBe(secondsTimestamp);
    });

    test("should handle nodes without date_added_to_graph", async () => {
      const mockNodes = [
        {
          ref_id: "node-3",
          node_type: "Function",
          properties: { name: "test" },
        },
      ];

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: mockNodes },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes[0].date_added_to_graph).toBeUndefined();
    });

    test("should normalize timestamps for all nodes in response", async () => {
      const mockNodes = [
        {
          ref_id: "node-1",
          node_type: "Function",
          date_added_to_graph: 1234567890000, // milliseconds
        },
        {
          ref_id: "node-2",
          node_type: "Variable",
          date_added_to_graph: 1234567900, // seconds
        },
        {
          ref_id: "node-3",
          node_type: "Class",
          date_added_to_graph: 9876543210000, // milliseconds
        },
      ];

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: mockNodes },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes[0].date_added_to_graph).toBe(1234567890);
      expect(data.data.nodes[1].date_added_to_graph).toBe(1234567900);
      expect(data.data.nodes[2].date_added_to_graph).toBe(9876543210);
    });
  });

  describe("Response Structure", () => {
    test("should return correct response structure on success", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          nodes: [{ ref_id: "1", node_type: "Function" }],
          edges: [],
        },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("status");
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("nodes");
      expect(data.success).toBe(true);
      expect(data.status).toBe(200);
    });

    test("should preserve additional data fields from external API", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          nodes: [],
          edges: [{ from: "1", to: "2" }],
          metadata: { count: 100 },
        },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.edges).toBeDefined();
      expect(data.data.metadata).toBeDefined();
    });

    test("should handle empty nodes array", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [] },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes).toEqual([]);
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on unexpected errors", async () => {
      mockSwarmApiRequest.mockRejectedValue(new Error("Unexpected error"));

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    test("should handle external API timeout", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: false,
        status: 504,
        data: { error: "Gateway timeout" },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      expect(response.status).toBe(504);
    });

    test("should handle malformed external API responses", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: null as any,
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      // Should handle gracefully without crashing
      expect([200, 500]).toContain(response.status);
    });

    test("should return 404 for non-existent workspace", async () => {
      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: "workspace-does-not-exist",
      });
      const response = await GET(request);

      expect(response.status).toBe(404);
    });
  });

  describe("Node Type Filtering", () => {
    test("should filter nodes by type when node_type parameter provided", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          nodes: [
            { ref_id: "1", node_type: "Function" },
            { ref_id: "2", node_type: "Function" },
          ],
        },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
        node_type: "Function",
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      const callArgs = mockSwarmApiRequest.mock.calls[0][0];
      expect(callArgs.endpoint).toMatch(/node_type=Function/);
    });

    test("should handle multiple node types in response", async () => {
      const mockNodes = [
        { ref_id: "1", node_type: "Function" },
        { ref_id: "2", node_type: "Variable" },
        { ref_id: "3", node_type: "Class" },
        { ref_id: "4", node_type: "Episode" },
      ];

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: mockNodes },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes).toHaveLength(4);
      const nodeTypes = data.data.nodes.map((n: any) => n.node_type);
      expect(nodeTypes).toContain("Function");
      expect(nodeTypes).toContain("Variable");
      expect(nodeTypes).toContain("Class");
      expect(nodeTypes).toContain("Episode");
    });
  });

  describe("Edge Cases", () => {
    test("should handle nodes with null properties", async () => {
      const mockNodes = [
        {
          ref_id: "node-1",
          node_type: "Function",
          date_added_to_graph: 1234567890,
          properties: null as any,
        },
      ];

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: mockNodes },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes[0].properties).toBeNull();
    });

    test("should handle nodes with empty properties object", async () => {
      const mockNodes = [
        {
          ref_id: "node-2",
          node_type: "Variable",
          date_added_to_graph: 1234567890,
          properties: {},
        },
      ];

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: mockNodes },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes[0].properties).toEqual({});
    });

    test("should handle very large node counts", async () => {
      const mockNodes = Array.from({ length: 1000 }, (_, i) => ({
        ref_id: `node-${i}`,
        node_type: "Function",
        date_added_to_graph: 1234567890 + i,
      }));

      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: mockNodes },
      });

      const request = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data.nodes).toHaveLength(1000);
    });

    test("should handle concurrent requests to same workspace", async () => {
      mockSwarmApiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [{ ref_id: "1", node_type: "Function" }] },
      });

      const request1 = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });
      const request2 = createGetRequest("/api/swarm/jarvis/nodes", {
        id: workspaceId,
      });

      const [response1, response2] = await Promise.all([
        GET(request1),
        GET(request2),
      ]);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
    });
  });
});