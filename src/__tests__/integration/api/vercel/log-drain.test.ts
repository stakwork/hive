import crypto from "crypto";
import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/vercel/log-drain/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { generateUniqueId, generateUniqueSlug } from "@/__tests__/support/helpers";
import { NextRequest } from "next/server";

/**
 * Integration Tests for POST /api/vercel/log-drain
 *
 * Tests Vercel log drain webhook endpoint including:
 * - Verification request handling (per-workspace secret)
 * - Per-workspace authentication via vercelWebhookSecret
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

const { pusherServer } = await import("@/lib/pusher");
const mockedPusherServer = vi.mocked(pusherServer);
const mockedFetch = vi.mocked(global.fetch);

describe("Vercel Logs Webhook - POST /api/vercel/log-drain", () => {
  // Initialize encryption service for test environment
  const encryptionService = EncryptionService.getInstance();
  const baseWebhookUrl = "http://localhost:3000/api/vercel/log-drain";
  const webhookSecret = "test-workspace-webhook-secret";

  // Helper to create webhook URL with workspace slug
  function getWebhookUrl(workspaceSlug: string) {
    return `${baseWebhookUrl}?workspace=${encodeURIComponent(workspaceSlug)}`;
  }

  // Helper to compute HMAC-SHA1 signature (same as route.ts)
  function computeSignature(body: string, secret: string): string {
    return crypto.createHmac("sha1", secret).update(Buffer.from(body, "utf-8")).digest("hex");
  }

  // Helper to create NextRequest with proper Content-Length header and signature
  function createRequest(workspaceSlug: string, body?: string, headers: Record<string, string> = {}): NextRequest {
    const requestHeaders: Record<string, string> = { ...headers };

    if (body) {
      requestHeaders["Content-Length"] = body.length.toString();
      // Add signature header for authenticated requests
      requestHeaders["x-vercel-signature"] = computeSignature(body, webhookSecret);
    } else {
      requestHeaders["Content-Length"] = "0";
    }

    return new NextRequest(getWebhookUrl(workspaceSlug), {
      method: "POST",
      headers: requestHeaders,
      body,
    });
  }

  // Helper to create test workspace with swarm and webhook secret
  async function createTestWorkspace(options?: { withWebhookSecret?: boolean; withSwarm?: boolean }) {
    const { withWebhookSecret = true, withSwarm = true } = options || {};

    const encryptedApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", "test-swarm-api-key"));
    const encryptedWebhookSecret = withWebhookSecret
      ? JSON.stringify(encryptionService.encryptField("vercelWebhookSecret", webhookSecret))
      : null;

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
          vercelWebhookSecret: encryptedWebhookSecret,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: "OWNER",
        },
      });

      let swarm = null;
      if (withSwarm) {
        swarm = await tx.swarm.create({
          data: {
            workspaceId: workspace.id,
            name: `swarm-${generateUniqueId()}.example.com`,
            swarmUrl: "https://test-swarm.example.com/api",
            swarmApiKey: encryptedApiKey,
            status: "ACTIVE",
          },
        });
      }

      return { user, workspace, swarm };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for fetch (stakgraph /nodes endpoint returns array directly)
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Request Validation", () => {
    test("should return 400 when workspace query parameter is missing", async () => {
      const request = new NextRequest(baseWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Length": "0",
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("workspace query parameter required");
    });

    test("should return 404 when workspace not found for slug", async () => {
      const request = createRequest("nonexistent-workspace");

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found");
    });
  });

  describe("Verification Requests", () => {
    test("should return 200 with x-vercel-verify header for verification request", async () => {
      const { workspace } = await createTestWorkspace();
      const request = createRequest(workspace.slug);

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("x-vercel-verify")).toBe(webhookSecret);
    });

    test("should return 500 when workspace has no webhook secret configured", async () => {
      const { workspace } = await createTestWorkspace({ withWebhookSecret: false });
      const request = createRequest(workspace.slug);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Webhook secret not configured for this workspace");
    });
  });

  describe("Authentication", () => {
    test("should return 401 when workspace has no webhook secret for data requests", async () => {
      const { workspace } = await createTestWorkspace({ withWebhookSecret: false });
      const body = JSON.stringify({ id: "log-1", message: "test" });
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Webhook secret not configured");
    });
  });

  describe("NDJSON Parsing", () => {
    test("should parse single NDJSON log entry", async () => {
      const { workspace } = await createTestWorkspace();

      const logEntry = {
        id: "log-1",
        message: "GET /api/health 200",
        timestamp: Date.now(),
        source: "lambda" as const,
        path: "/api/health",
      };

      const body = JSON.stringify(logEntry);
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.processed).toBe(1);
    });

    test("should parse multiple NDJSON log entries", async () => {
      const { workspace } = await createTestWorkspace();

      const log1 = {
        id: "log-1",
        message: "test 1",
        timestamp: Date.now(),
        source: "lambda" as const,
      };
      const log2 = {
        id: "log-2",
        message: "test 2",
        timestamp: Date.now(),
        source: "lambda" as const,
      };

      const ndjsonBody = `${JSON.stringify(log1)}\n${JSON.stringify(log2)}`;
      const request = createRequest(workspace.slug, ndjsonBody);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.processed).toBe(2);
    });

    test("should handle malformed JSON entries gracefully", async () => {
      const { workspace } = await createTestWorkspace();

      const log1 = { id: "log-1", message: "valid", timestamp: Date.now(), source: "lambda" as const };
      const ndjsonBody = `${JSON.stringify(log1)}\n{invalid json}\n${JSON.stringify(log1)}`;
      const request = createRequest(workspace.slug, ndjsonBody);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.processed).toBe(2); // Only valid entries processed
    });

    test("should handle empty lines in NDJSON", async () => {
      const { workspace } = await createTestWorkspace();

      const log1 = { id: "log-1", message: "test", timestamp: Date.now(), source: "lambda" as const };
      const ndjsonBody = `${JSON.stringify(log1)}\n\n\n${JSON.stringify(log1)}\n`;
      const request = createRequest(workspace.slug, ndjsonBody);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.processed).toBe(2);
    });

    test("should return 400 when no valid entries found", async () => {
      const { workspace } = await createTestWorkspace();

      const body = "{invalid}\n{also invalid}";
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("No valid log entries found");
    });
  });

  describe("Path Matching and Highlighting", () => {
    test("should match exact path and broadcast highlight", async () => {
      const { workspace } = await createTestWorkspace();

      // Mock stakgraph /nodes response (returns array directly with EndpointNode format)
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            name: "/api/health",
            file: "src/app/api/health/route.ts",
            ref_id: "endpoint-1",
          },
        ],
      } as Response);

      const logEntry = {
        id: "log-1",
        message: "GET /api/health 200",
        timestamp: Date.now(),
        source: "lambda" as const,
        path: "/api/health",
      };

      const body = JSON.stringify(logEntry);
      const request = createRequest(workspace.slug, body);

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
          title: "/api/health",
        }),
      );
    });

    test("should match dynamic path with [id] pattern", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            name: "/api/users/[id]",
            file: "src/app/api/users/[id]/route.ts",
            ref_id: "endpoint-users",
          },
        ],
      } as Response);

      const logEntry = {
        id: "log-1",
        message: "GET /api/users/123 200",
        timestamp: Date.now(),
        source: "lambda" as const,
        path: "/api/users/123",
      };

      const body = JSON.stringify(logEntry);
      const request = createRequest(workspace.slug, body);

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
        json: async () => [
          {
            name: "/api/health",
            file: "src/app/api/health/route.ts",
            ref_id: "endpoint-1",
          },
        ],
      } as Response);

      const logEntry = {
        id: "log-1",
        message: "Proxy request",
        timestamp: Date.now(),
        source: "lambda" as const,
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

      const body = JSON.stringify(logEntry);
      const request = createRequest(workspace.slug, body);

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
        // No path field
      };

      const body = JSON.stringify(logEntry);
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.processed).toBe(1);
      expect(data.highlighted).toBe(0);
      expect(pusherServer.trigger).not.toHaveBeenCalled();
    });

    test("should skip when no matching endpoint found", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            name: "/api/different",
            file: "src/app/api/different/route.ts",
            ref_id: "endpoint-1",
          },
        ],
      } as Response);

      const logEntry = {
        id: "log-1",
        message: "test",
        timestamp: Date.now(),
        source: "lambda" as const,
        path: "/api/unknown",
      };

      const body = JSON.stringify(logEntry);
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.highlighted).toBe(0);
    });
  });

  describe("Workspace Filtering", () => {
    test("should return 404 for soft-deleted workspaces", async () => {
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
        path: "/api/health",
      };

      const body = JSON.stringify(logEntry);
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found");
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
        path: "/api/health",
      };

      const body = JSON.stringify(logEntry);
      const request = createRequest(workspace.slug, body);

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
        json: async () => [
          {
            name: "/api/health",
            file: "src/app/api/health/route.ts",
            ref_id: "endpoint-1",
          },
        ],
      } as Response);

      mockedPusherServer.trigger.mockRejectedValueOnce(new Error("Pusher error"));

      const logEntry = {
        id: "log-1",
        message: "test",
        timestamp: Date.now(),
        source: "lambda" as const,
        path: "/api/health",
      };

      const body = JSON.stringify(logEntry);
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      // Should still succeed despite Pusher failure
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});
