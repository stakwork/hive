import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/graph/nodes/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  generateUniqueId,
  generateUniqueSlug,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { NextRequest } from "next/server";

describe("GET /api/workspaces/[slug]/graph/nodes", () => {
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_SWARM_API_KEY = "swarm_graph_test_key_xyz";
  const MOCK_SWARM_URL = "https://test-swarm.sphinx.chat/api";

  let userId: string;
  let workspaceId: string;
  let workspaceSlug: string;
  let swarmId: string;

  const createTestRequest = (
    slug: string,
    params: { node_type?: string; output?: string } = {}
  ): NextRequest => {
    const url = new URL(
      `http://localhost:3000/api/workspaces/${slug}/graph/nodes`
    );
    if (params.node_type) url.searchParams.set("node_type", params.node_type);
    if (params.output) url.searchParams.set("output", params.output);

    return new NextRequest(url);
  };

  const createMockGraphResponse = (nodeCount: number = 3) => {
    const nodes = Array.from({ length: nodeCount }, (_, i) => ({
      node_type: "Function",
      ref_id: `node-${i}`,
      weight: 10 + i,
      test_count: i,
      covered: i % 2 === 0,
      properties: {
        name: `testFunction${i}`,
        file: `src/utils/test${i}.ts`,
        start: 10 * i,
        end: 10 * i + 50,
      },
    }));

    return {
      nodes,
      edges: [
        { source: "node-0", target: "node-1", type: "calls" },
        { source: "node-1", target: "node-2", type: "calls" },
      ],
    };
  };

  beforeEach(async () => {
    vi.clearAllMocks();

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
          name: "test-swarm",
          swarmId: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: MOCK_SWARM_URL,
          swarmApiKey: JSON.stringify(
            enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY)
          ),
          services: [],
        },
      });

      return { user, workspace, swarm };
    });

    userId = testData.user.id;
    workspaceId = testData.workspace.id;
    workspaceSlug = testData.workspace.slug;
    swarmId = testData.swarm.swarmId!;

    getMockedSession().mockResolvedValue(
      createAuthenticatedSession(testData.user)
    );
  });

  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createTestRequest(workspaceSlug, {
        node_type: "Function",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(401);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({
        user: null,
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createTestRequest(workspaceSlug, {
        node_type: "Function",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(401);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Unauthorized");
    });

    it("returns 401 when session user has no id", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createTestRequest(workspaceSlug, {
        node_type: "Function",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(401);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Invalid user session");
    });
  });

  describe("Workspace Authorization", () => {
    it("returns 404 when workspace does not exist", async () => {
      const request = createTestRequest("non-existent-workspace", {
        node_type: "Function",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: "non-existent-workspace" }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(404);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe(
        "Workspace not found or access denied"
      );
    });

    it("returns 404 when user does not have access to workspace", async () => {
      const unauthorizedUser = await db.user.create({
        data: {
          id: generateUniqueId("unauthorized"),
          email: `unauthorized-${generateUniqueId()}@example.com`,
          name: "Unauthorized User",
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(unauthorizedUser)
      );

      const request = createTestRequest(workspaceSlug, {
        node_type: "Function",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(404);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe(
        "Workspace not found or access denied"
      );
    });
  });

  describe("Parameter Validation", () => {
    it("returns 400 when node_type parameter is missing", async () => {
      const request = createTestRequest(workspaceSlug, {});
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(400);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe(
        "Missing required parameter: node_type"
      );
    });

    it("accepts valid node_type parameter", async () => {
      const mockResponse = createMockGraphResponse();
      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        } as unknown as Response);

      const request = createTestRequest(workspaceSlug, {
        node_type: "Function",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it("defaults output parameter to json when not provided", async () => {
      const mockResponse = createMockGraphResponse();
      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        } as unknown as Response);

      const request = createTestRequest(workspaceSlug, {
        node_type: "Function",
      });
      await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });

      const fetchCall = fetchSpy.mock.calls[0];
      const fetchUrl = fetchCall[0] as string;
      expect(fetchUrl).toContain("output=json");
    });

    it("accepts custom output parameter", async () => {
      const mockResponse = createMockGraphResponse();
      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        } as unknown as Response);

      const request = createTestRequest(workspaceSlug, {
        node_type: "Endpoint",
        output: "csv",
      });
      await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });

      const fetchCall = fetchSpy.mock.calls[0];
      const fetchUrl = fetchCall[0] as string;
      expect(fetchUrl).toContain("output=csv");
    });
  });

  describe("Swarm Configuration", () => {
    it("returns 404 when swarm does not exist for workspace", async () => {
      await db.swarm.delete({
        where: { workspaceId },
      });

      const request = createTestRequest(workspaceSlug, {
        node_type: "Function",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(404);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe(
        "Swarm not found for this workspace"
      );
    });

    it("returns 400 when swarm has no swarmUrl", async () => {
      await db.swarm.update({
        where: { workspaceId },
        data: { swarmUrl: null },
      });

      const request = createTestRequest(workspaceSlug, {
        node_type: "Function",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(400);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe(
        "Swarm configuration is incomplete"
      );
    });

    it("returns 400 when swarm has no swarmApiKey", async () => {
      await db.swarm.update({
        where: { workspaceId },
        data: { swarmApiKey: null },
      });

      const request = createTestRequest(workspaceSlug, {
        node_type: "Function",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(400);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe(
        "Swarm configuration is incomplete"
      );
    });
  });

  describe("Data Integrity & Encryption", () => {
    it("uses decrypted API key in external request while keeping DB encrypted", async () => {
      const mockResponse = createMockGraphResponse();
      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        } as unknown as Response);

      const request = createTestRequest(workspaceSlug, {
        node_type: "Function",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody.success).toBe(true);

      const firstCall = fetchSpy.mock.calls[0] as [
        string,
        { headers?: Record<string, string> }
      ];
      const headers = (firstCall?.[1]?.headers || {}) as Record<string, string>;
      expect(Object.values(headers).join(" ")).toContain(
        PLAINTEXT_SWARM_API_KEY
      );

      const swarm = await db.swarm.findFirst({ where: { swarmId } });
      const stored = swarm?.swarmApiKey || "";
      expect(stored).not.toContain(PLAINTEXT_SWARM_API_KEY);
    });

    it("constructs correct graph URL with port 3355", async () => {
      const mockResponse = createMockGraphResponse();
      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        } as unknown as Response);

      const request = createTestRequest(workspaceSlug, {
        node_type: "Endpoint",
      });
      await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });

      const fetchCall = fetchSpy.mock.calls[0];
      const fetchUrl = fetchCall[0] as string;
      expect(fetchUrl).toContain(":3355/nodes");
      expect(fetchUrl).toContain("node_type=Endpoint");
    });

    it("returns valid response structure with success and data", async () => {
      const mockResponse = createMockGraphResponse(5);
      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        } as unknown as Response);

      const request = createTestRequest(workspaceSlug, {
        node_type: "Class",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody).toHaveProperty("success", true);
      expect(responseBody).toHaveProperty("data");
      expect(responseBody.data).toHaveProperty("nodes");
      expect(responseBody.data).toHaveProperty("edges");
      expect(Array.isArray(responseBody.data.nodes)).toBe(true);
      expect(responseBody.data.nodes).toHaveLength(5);
    });
  });

  describe("External Service Error Handling", () => {
    it("returns error response when external service fails", async () => {
      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: false,
          status: 503,
          json: async () => ({ error: "Service unavailable" }),
        } as unknown as Response);

      const request = createTestRequest(workspaceSlug, {
        node_type: "Function",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(503);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Failed to fetch graph nodes");
      expect(responseBody).toHaveProperty("details");
    });

    it("returns 500 when external service times out", async () => {
      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockRejectedValue(new Error("Request timeout"));

      const request = createTestRequest(workspaceSlug, {
        node_type: "Function",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(500);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Failed to fetch graph nodes");
    });

    it("handles malformed external service responses", async () => {
      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => null,
        } as unknown as Response);

      const request = createTestRequest(workspaceSlug, {
        node_type: "Endpoint",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(500);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Failed to fetch graph nodes");
    });
  });

  describe("Performance & Large Datasets", () => {
    it("handles large node datasets correctly", async () => {
      const mockResponse = createMockGraphResponse(150);
      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        } as unknown as Response);

      const request = createTestRequest(workspaceSlug, {
        node_type: "Function",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.nodes).toHaveLength(150);
    });

    it("handles empty node responses", async () => {
      const mockResponse = { nodes: [], edges: [] };
      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        } as unknown as Response);

      const request = createTestRequest(workspaceSlug, {
        node_type: "Class",
      });
      const res = await GET(request, {
        params: Promise.resolve({ slug: workspaceSlug }),
      });
      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.nodes).toHaveLength(0);
      expect(responseBody.data.edges).toHaveLength(0);
    });
  });

  describe("Different Node Types", () => {
    it.each([
      ["Function", "function"],
      ["Endpoint", "endpoint"],
      ["Class", "class"],
      ["E2etest", "e2e test"],
      ["IntegrationTest", "integration test"],
    ])(
      "successfully fetches %s nodes",
      async (nodeType, _description) => {
        const mockResponse = createMockGraphResponse();
        const fetchSpy = vi
          .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
          .mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => mockResponse,
          } as unknown as Response);

        const request = createTestRequest(workspaceSlug, {
          node_type: nodeType,
        });
        const res = await GET(request, {
          params: Promise.resolve({ slug: workspaceSlug }),
        });
        const responseBody = await res.json();

        expect(res.status).toBe(200);
        expect(responseBody.success).toBe(true);

        const fetchCall = fetchSpy.mock.calls[0];
        const fetchUrl = fetchCall[0] as string;
        expect(fetchUrl).toContain(`node_type=${nodeType}`);
      }
    );
  });
});