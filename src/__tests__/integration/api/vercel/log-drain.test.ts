import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/vercel/log-drain/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";

/**
 * Integration Tests for POST /api/vercel/log-drain
 * 
 * Tests Vercel log drain webhook endpoint including:
 * - Verification request handling
 * - Per-workspace authentication
 * - NDJSON payload parsing
 * - Path matching and highlighting
 */

// Mock Pusher service
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    HIGHLIGHT_NODES: "highlight-nodes",
  },
}));

// Mock fetch for swarm gitree endpoint
global.fetch = vi.fn();

const { pusherServer, getWorkspaceChannelName, PUSHER_EVENTS } = await import(
  "@/lib/pusher"
);
const mockedPusherServer = vi.mocked(pusherServer);
const mockedFetch = vi.mocked(global.fetch);

describe("Vercel Logs Webhook - POST /api/vercel/logs", () => {
  // Initialize encryption service for test environment
  EncryptionService.getInstance();
  const webhookUrl = "http://localhost:3000/api/vercel/logs";
  const validApiKey = "test-vercel-webhook-api-key";
  const verifySecret = "test-vercel-verify-secret";

  // Helper to create request with proper Content-Length header
  function createRequest(body?: string, headers: Record<string, string> = {}) {
    const requestHeaders: Record<string, string> = { ...headers };
    
    if (body) {
      requestHeaders["Content-Length"] = body.length.toString();
    } else {
      requestHeaders["Content-Length"] = "0";
    }
    
    return new Request(webhookUrl, {
      method: "POST",
      headers: requestHeaders,
      body,
    });
  }

  // Helper to create test workspace with swarm
  async function createTestWorkspace(vercelProjectId?: string) {
    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = JSON.stringify(
      encryptionService.encryptField("swarmApiKey", "test-swarm-api-key")
    );

    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: `Test Workspace ${generateUniqueId()}`,
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
          vercelProjectId: vercelProjectId || `prj_${generateUniqueId()}`,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: "OWNER",
        },
      });

      const swarm = await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: `swarm-${generateUniqueId()}.example.com`,
          swarmUrl: "https://test-swarm.example.com/api",
          swarmApiKey: encryptedApiKey,
          status: "ACTIVE",
        },
      });

      return { user, workspace, swarm };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_WEBHOOK_API_KEY = validApiKey;
    process.env.VERCEL_WEBHOOK_SECRET = verifySecret;
    
    // Default mock for fetch (gitree endpoint)
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ endpoints: [] }),
    } as Response);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Verification Requests", () => {
    test("should return 200 with x-vercel-verify header for verification request", async () => {
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "content-length": "0",
          "x-api-key": validApiKey,
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("x-vercel-verify")).toBe(verifySecret);
    });

    test("should return 500 when VERCEL_WEBHOOK_SECRET not configured", async () => {
      delete process.env.VERCEL_WEBHOOK_SECRET;

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "content-length": "0",
          "x-api-key": validApiKey,
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Server configuration error");
    });
  });

  describe("Authentication", () => {
    test("should return 401 when x-api-key header is missing", async () => {
      const body = JSON.stringify({ id: "log-1", message: "test" });
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length.toString(),
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 when x-api-key is invalid", async () => {
      const body = JSON.stringify({ id: "log-1", message: "test" });
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "invalid-key",
          "Content-Length": body.length.toString(),
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("NDJSON Parsing", () => {
    test("should parse single NDJSON log entry", async () => {
      const logEntry = {
        id: "log-1",
        message: "GET /api/health 200",
        timestamp: Date.now(),
        source: "lambda" as const,
        projectId: "prj-test",
        path: "/api/health",
      };

      const body = JSON.stringify(logEntry);
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
          "Content-Length": body.length.toString(),
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.processed).toBe(1);
    });

    test("should parse multiple NDJSON log entries", async () => {
      const log1 = {
        id: "log-1",
        message: "test 1",
        timestamp: Date.now(),
        source: "lambda" as const,
        projectId: "prj-test",
      };
      const log2 = {
        id: "log-2",
        message: "test 2",
        timestamp: Date.now(),
        source: "lambda" as const,
        projectId: "prj-test",
      };

      const ndjsonBody = `${JSON.stringify(log1)}\n${JSON.stringify(log2)}`;

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
          "Content-Length": ndjsonBody.length.toString(),
        },
        body: ndjsonBody,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.processed).toBe(2);
    });

    test("should handle malformed JSON entries gracefully", async () => {
      const log1 = { id: "log-1", message: "valid", timestamp: Date.now(), source: "lambda" as const };
      const ndjsonBody = `${JSON.stringify(log1)}\n{invalid json}\n${JSON.stringify(log1)}`;

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
          "Content-Length": ndjsonBody.length.toString(),
        },
        body: ndjsonBody,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.processed).toBe(2); // Only valid entries processed
    });

    test("should handle empty lines in NDJSON", async () => {
      const log1 = { id: "log-1", message: "test", timestamp: Date.now(), source: "lambda" as const };
      const ndjsonBody = `${JSON.stringify(log1)}\n\n\n${JSON.stringify(log1)}\n`;

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
          "Content-Length": ndjsonBody.length.toString(),
        },
        body: ndjsonBody,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.processed).toBe(2);
    });

    test("should return 400 when no valid entries found", async () => {
      const body = "{invalid}\n{also invalid}";
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
          "Content-Length": body.length.toString(),
        },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("No valid log entries found");
    });
  });

  describe("Path Matching and Highlighting", () => {
    test("should match exact path and broadcast highlight", async () => {
      const { workspace } = await createTestWorkspace();

      // Mock gitree response with endpoint nodes
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          endpoints: [
            {
              node_type: "Endpoint",
              ref_id: "endpoint-1",
              weight: 1,
              test_count: 0,
              covered: false,
              properties: {
                path: "/api/health",
                name: "/api/health",
              },
            },
          ],
        }),
      } as Response);

      const logEntry = {
        id: "log-1",
        message: "GET /api/health 200",
        timestamp: Date.now(),
        source: "lambda" as const,
        projectId: workspace.vercelProjectId,
        path: "/api/health",
      };

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
                  "Content-Length": JSON.stringify(logEntry).length.toString(),
        },
        body: JSON.stringify(logEntry),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.highlighted).toBe(1);

      // Verify Pusher was called
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `workspace-${workspace.slug}`,
        "highlight-nodes",
        expect.objectContaining({
          nodeIds: ["endpoint-1"],
          workspaceId: workspace.slug,
          title: "Vercel Request",
        })
      );
    });

    test("should match dynamic path with [id] pattern", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          endpoints: [
            {
              node_type: "Endpoint",
              ref_id: "endpoint-users",
              weight: 1,
              test_count: 0,
              covered: false,
              properties: {
                path: "/api/users/[id]",
                name: "/api/users/[id]",
              },
            },
          ],
        }),
      } as Response);

      const logEntry = {
        id: "log-1",
        message: "GET /api/users/123 200",
        timestamp: Date.now(),
        source: "lambda" as const,
        projectId: workspace.vercelProjectId,
        path: "/api/users/123",
      };

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
                  "Content-Length": JSON.stringify(logEntry).length.toString(),
        },
        body: JSON.stringify(logEntry),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.highlighted).toBe(1);
      expect(pusherServer.trigger).toHaveBeenCalled();
    });

    test("should extract path from proxy object", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          endpoints: [
            {
              node_type: "Endpoint",
              ref_id: "endpoint-1",
              weight: 1,
              test_count: 0,
              covered: false,
              properties: {
                path: "/api/health",
                name: "/api/health",
              },
            },
          ],
        }),
      } as Response);

      const logEntry = {
        id: "log-1",
        message: "Proxy request",
        timestamp: Date.now(),
        source: "lambda" as const,
        projectId: workspace.vercelProjectId,
        proxy: {
          timestamp: Date.now(),
          method: "GET",
          scheme: "https",
          host: "example.com",
          path: "/api/health",
          userAgent: "test",
          referer: "",
          statusCode: 200,
          clientIp: "1.2.3.4",
          region: "sfo1",
        },
      };

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
                  "Content-Length": JSON.stringify(logEntry).length.toString(),
        },
        body: JSON.stringify(logEntry),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.highlighted).toBe(1);
    });

    test("should skip entries without path", async () => {
      const { workspace } = await createTestWorkspace();

      const logEntry = {
        id: "log-1",
        message: "Build completed",
        timestamp: Date.now(),
        source: "build" as const,
        projectId: workspace.vercelProjectId,
        // No path field
      };

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
                  "Content-Length": JSON.stringify(logEntry).length.toString(),
        },
        body: JSON.stringify(logEntry),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.processed).toBe(1);
      expect(data.highlighted).toBe(0);
      expect(pusherServer.trigger).not.toHaveBeenCalled();
    });

    test("should skip entries without projectId", async () => {
      const logEntry = {
        id: "log-1",
        message: "test",
        timestamp: Date.now(),
        source: "lambda" as const,
        path: "/api/health",
        // No projectId
      };

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
                  "Content-Length": JSON.stringify(logEntry).length.toString(),
        },
        body: JSON.stringify(logEntry),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.highlighted).toBe(0);
    });

    test("should skip entries for unmapped projects", async () => {
      const logEntry = {
        id: "log-1",
        message: "test",
        timestamp: Date.now(),
        source: "lambda" as const,
        projectId: "prj-unmapped",
        path: "/api/health",
      };

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
                  "Content-Length": JSON.stringify(logEntry).length.toString(),
        },
        body: JSON.stringify(logEntry),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.highlighted).toBe(0);
    });

    test("should skip when no matching endpoint found", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          endpoints: [
            {
              node_type: "Endpoint",
              ref_id: "endpoint-1",
              weight: 1,
              test_count: 0,
              covered: false,
              properties: {
                path: "/api/different",
                name: "/api/different",
              },
            },
          ],
        }),
      } as Response);

      const logEntry = {
        id: "log-1",
        message: "test",
        timestamp: Date.now(),
        source: "lambda" as const,
        projectId: workspace.vercelProjectId,
        path: "/api/unknown",
      };

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
                  "Content-Length": JSON.stringify(logEntry).length.toString(),
        },
        body: JSON.stringify(logEntry),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.highlighted).toBe(0);
    });
  });

  describe("Workspace Filtering", () => {
    test("should filter out soft-deleted workspaces", async () => {
      const { workspace } = await createTestWorkspace();

      // Soft delete workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const logEntry = {
        id: "log-1",
        message: "test",
        timestamp: Date.now(),
        source: "lambda" as const,
        projectId: workspace.vercelProjectId,
        path: "/api/health",
      };

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
                  "Content-Length": JSON.stringify(logEntry).length.toString(),
        },
        body: JSON.stringify(logEntry),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.highlighted).toBe(0);
    });
  });

  describe("Error Handling", () => {
    test("should handle fetch errors gracefully", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockRejectedValueOnce(new Error("Network error"));

      const logEntry = {
        id: "log-1",
        message: "test",
        timestamp: Date.now(),
        source: "lambda" as const,
        projectId: workspace.vercelProjectId,
        path: "/api/health",
      };

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
                  "Content-Length": JSON.stringify(logEntry).length.toString(),
        },
        body: JSON.stringify(logEntry),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.highlighted).toBe(0);
    });

    test("should handle Pusher broadcast errors gracefully", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          endpoints: [
            {
              node_type: "Endpoint",
              ref_id: "endpoint-1",
              weight: 1,
              test_count: 0,
              covered: false,
              properties: {
                path: "/api/health",
                name: "/api/health",
              },
            },
          ],
        }),
      } as Response);

      mockedPusherServer.trigger.mockRejectedValueOnce(
        new Error("Pusher error")
      );

      const logEntry = {
        id: "log-1",
        message: "test",
        timestamp: Date.now(),
        source: "lambda" as const,
        projectId: workspace.vercelProjectId,
        path: "/api/health",
      };

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-api-key": validApiKey,
                  "Content-Length": JSON.stringify(logEntry).length.toString(),
        },
        body: JSON.stringify(logEntry),
      });

      const response = await POST(request);
      const data = await response.json();

      // Should still succeed despite Pusher failure
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});
