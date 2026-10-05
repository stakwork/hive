import crypto from "crypto";
import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/vercel/log-drain/route";
import {
  resetEndpointCache,
  endpointCache,
  ENDPOINT_CACHE_TTL_MS,
  ENDPOINT_EMPTY_CACHE_TTL_MS,
} from "@/app/api/vercel/log-drain/endpoint-cache";
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
 * - Endpoint-node caching (long TTL for a real list, short negative TTL for
 *   empty/failed lookups) and in-flight coalescing
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

  // Helper: a single log entry with a matchable path
  function makeLogEntry(path: string, id = "log-1") {
    return {
      id,
      message: `GET ${path} 200`,
      timestamp: Date.now(),
      source: "lambda" as const,
      path,
    };
  }

  // Helper: a single endpoint node
  function makeEndpointNode(name: string, refId: string) {
    return { name, file: `src/app${name}/route.ts`, ref_id: refId };
  }

  // Helper: age every cache entry past its TTL without touching the clock
  function expireEndpointCache() {
    for (const entry of endpointCache.values()) {
      entry.expiresAt = 0;
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level cache so tests are fully isolated
    resetEndpointCache();
    // Default mock: /nodes returns empty array
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetEndpointCache();
  });

  // ---------------------------------------------------------------------------
  // Request Validation
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Verification Requests
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // NDJSON Parsing
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Path Matching and Highlighting
  // ---------------------------------------------------------------------------

  describe("Path Matching and Highlighting", () => {
    test("should match exact path and broadcast highlight", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeEndpointNode("/api/health", "endpoint-1")],
      } as Response);

      const body = JSON.stringify(makeLogEntry("/api/health"));
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.highlighted).toBe(1);

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `workspace-${workspace.slug}`,
        "highlight-nodes",
        expect.objectContaining({
          nodeIds: ["endpoint-1"],
          workspaceId: workspace.slug,
          title: "Health",
        }),
      );
    });

    test("should match dynamic path with [id] pattern", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeEndpointNode("/api/users/[id]", "endpoint-users")],
      } as Response);

      const body = JSON.stringify(makeLogEntry("/api/users/123"));
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
        json: async () => [makeEndpointNode("/api/health", "endpoint-1")],
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
      // No path → early-out, fetch never called
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    test("should skip when no matching endpoint found", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeEndpointNode("/api/different", "endpoint-1")],
      } as Response);

      const body = JSON.stringify(makeLogEntry("/api/unknown"));
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.highlighted).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Workspace Filtering
  // ---------------------------------------------------------------------------

  describe("Workspace Filtering", () => {
    test("should return 404 for soft-deleted workspaces", async () => {
      const { workspace } = await createTestWorkspace();

      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const body = JSON.stringify(makeLogEntry("/api/health"));
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found");
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  describe("Error Handling", () => {
    test("should handle fetch errors gracefully", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockRejectedValueOnce(new Error("Network error"));

      const body = JSON.stringify(makeLogEntry("/api/health"));
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
        json: async () => [makeEndpointNode("/api/health", "endpoint-1")],
      } as Response);

      mockedPusherServer.trigger.mockRejectedValueOnce(new Error("Pusher error"));

      const body = JSON.stringify(makeLogEntry("/api/health"));
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache and coalescing behaviour  (acceptance-criteria tests)
  // ---------------------------------------------------------------------------

  describe("Endpoint node caching and coalescing", () => {
    // (a) Two sequential batches for the same swarm within TTL → 1 fetch
    test("(a) sequential batches within TTL share one /nodes fetch", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockResolvedValue({
        ok: true,
        json: async () => [makeEndpointNode("/api/health", "endpoint-1")],
      } as Response);

      const body = JSON.stringify(makeLogEntry("/api/health"));

      // First batch
      const r1 = await POST(createRequest(workspace.slug, body));
      expect((await r1.json()).highlighted).toBe(1);

      // Second batch — should reuse cache, no second fetch
      const r2 = await POST(createRequest(workspace.slug, body));
      expect((await r2.json()).highlighted).toBe(1);

      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    // (b) Concurrent batches for the same swarm coalesce to one fetch
    test("(b) concurrent batches coalesce to one /nodes fetch", async () => {
      const { workspace } = await createTestWorkspace();

      // Deferred fetch: resolves manually so both callers are in-flight together
      let resolveNodes!: (nodes: Response) => void;
      const deferredFetch = new Promise<Response>((res) => {
        resolveNodes = res;
      });

      mockedFetch.mockReturnValueOnce(deferredFetch);

      const body = JSON.stringify(makeLogEntry("/api/health"));

      // Fire both concurrently — neither awaited yet
      const p1 = POST(createRequest(workspace.slug, body));
      const p2 = POST(createRequest(workspace.slug, body));

      // Resolve the single deferred fetch with a healthy response
      resolveNodes({
        ok: true,
        json: async () => [makeEndpointNode("/api/health", "endpoint-1")],
      } as Response);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect((await r1.json()).highlighted).toBe(1);
      expect((await r2.json()).highlighted).toBe(1);

      // Only one actual network call despite two concurrent POST handlers
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    // (c) A fetch error is remembered for the short negative TTL, then retried.
    // Without this a lock-bound swarm was asked again on every log batch.
    test("(c) fetch error is not retried on the next batch, only after the negative TTL", async () => {
      const { workspace } = await createTestWorkspace();

      // First call: network error
      mockedFetch.mockRejectedValueOnce(new Error("Network error"));

      const body = JSON.stringify(makeLogEntry("/api/health"));

      const r1 = await POST(createRequest(workspace.slug, body));
      const d1 = await r1.json();
      expect(r1.status).toBe(200);
      expect(d1.success).toBe(true);
      expect(d1.highlighted).toBe(0);

      // Second batch inside the negative TTL: no second /nodes call
      const r2 = await POST(createRequest(workspace.slug, body));
      expect((await r2.json()).highlighted).toBe(0);
      expect(mockedFetch).toHaveBeenCalledTimes(1);

      // After the negative TTL the swarm is asked again and recovers
      expireEndpointCache();
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeEndpointNode("/api/health", "endpoint-1")],
      } as Response);

      const r3 = await POST(createRequest(workspace.slug, body));
      expect((await r3.json()).highlighted).toBe(1);
      expect(mockedFetch).toHaveBeenCalledTimes(2);
    });

    // (c-variant) A non-OK response follows the same short negative TTL
    test("(c) non-OK /nodes response is retried only after the negative TTL", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockResolvedValueOnce({ ok: false, status: 503 } as Response);

      const body = JSON.stringify(makeLogEntry("/api/health"));
      const r1 = await POST(createRequest(workspace.slug, body));
      expect(r1.status).toBe(200);

      const r2 = await POST(createRequest(workspace.slug, body));
      expect((await r2.json()).highlighted).toBe(0);
      expect(mockedFetch).toHaveBeenCalledTimes(1);

      expireEndpointCache();
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeEndpointNode("/api/health", "endpoint-1")],
      } as Response);

      const r3 = await POST(createRequest(workspace.slug, body));
      expect((await r3.json()).highlighted).toBe(1);
      expect(mockedFetch).toHaveBeenCalledTimes(2);
    });

    // (d) Successful empty [] (swarm mid-ingest) is remembered for the short TTL, then re-fetched
    test("(d) successful empty /nodes response is re-fetched only after the negative TTL", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch
        .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [makeEndpointNode("/api/health", "endpoint-1")],
        } as Response);

      const body = JSON.stringify(makeLogEntry("/api/health"));

      const r1 = await POST(createRequest(workspace.slug, body));
      expect((await r1.json()).highlighted).toBe(0); // empty nodes → no match

      const r2 = await POST(createRequest(workspace.slug, body));
      expect((await r2.json()).highlighted).toBe(0); // still inside the negative TTL
      expect(mockedFetch).toHaveBeenCalledTimes(1);

      expireEndpointCache();
      const r3 = await POST(createRequest(workspace.slug, body));
      expect((await r3.json()).highlighted).toBe(1); // second fetch returned a node
      expect(mockedFetch).toHaveBeenCalledTimes(2);
    });

    // (d-variant) A real list lives for the long TTL, an empty one only for the short TTL
    test("(d) non-empty lists get the long TTL, empty ones the short negative TTL", async () => {
      const { workspace, swarm } = await createTestWorkspace();
      const body = JSON.stringify(makeLogEntry("/api/health"));

      mockedFetch.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);
      await POST(createRequest(workspace.slug, body));

      const emptyEntry = endpointCache.get(swarm!.id);
      expect(emptyEntry?.nodes).toEqual([]);
      const emptyTtl = emptyEntry!.expiresAt - Date.now();
      expect(emptyTtl).toBeGreaterThan(ENDPOINT_EMPTY_CACHE_TTL_MS - 5_000);
      expect(emptyTtl).toBeLessThanOrEqual(ENDPOINT_EMPTY_CACHE_TTL_MS);

      expireEndpointCache();
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeEndpointNode("/api/health", "endpoint-1")],
      } as Response);
      await POST(createRequest(workspace.slug, body));

      const fullEntry = endpointCache.get(swarm!.id);
      expect(fullEntry?.nodes).toHaveLength(1);
      const fullTtl = fullEntry!.expiresAt - Date.now();
      expect(fullTtl).toBeGreaterThan(ENDPOINT_EMPTY_CACHE_TTL_MS);
      expect(fullTtl).toBeLessThanOrEqual(ENDPOINT_CACHE_TTL_MS);

      // The /nodes request is bounded by a timeout so a lock-bound swarm cannot pin the handler
      const init = mockedFetch.mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    // (e) Pathless-only batch → success, fetch never called
    test("(e) batch with no usable paths returns success without calling fetch", async () => {
      const { workspace } = await createTestWorkspace();

      const pathlessEntry = {
        id: "log-build",
        message: "Build completed successfully",
        timestamp: Date.now(),
        source: "build" as const,
        // intentionally no `path` or `proxy`
      };

      const body = JSON.stringify(pathlessEntry);
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.processed).toBe(1);
      expect(data.matched).toBe(0);
      expect(data.highlighted).toBe(0);
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    // (e-variant) Mixed batch: some pathless, some with path → fetch IS called
    test("(e) mixed batch (some pathless) still fetches because at least one entry has a path", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [makeEndpointNode("/api/health", "endpoint-1")],
      } as Response);

      const pathlessEntry = { id: "b", message: "build", timestamp: Date.now(), source: "build" as const };
      const pathEntry = makeLogEntry("/api/health", "p");
      const body = `${JSON.stringify(pathlessEntry)}\n${JSON.stringify(pathEntry)}`;
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.processed).toBe(2);
      expect(data.highlighted).toBe(1);
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    // (f) Empty logEntries → 400 (early-out must not swallow this)
    test("(f) all-invalid NDJSON still returns 400 — early-out does not swallow it", async () => {
      const { workspace } = await createTestWorkspace();

      const body = "{invalid}\n{also invalid}";
      const request = createRequest(workspace.slug, body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("No valid log entries found");
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    // (g) Normal batch with matchable paths → correct shape + Pusher (regression)
    test("(g) normal batch returns correct shape and triggers Pusher highlights", async () => {
      const { workspace } = await createTestWorkspace();

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          makeEndpointNode("/api/health", "endpoint-health"),
          makeEndpointNode("/api/users/[id]", "endpoint-users"),
        ],
      } as Response);

      const entry1 = makeLogEntry("/api/health", "l1");
      const entry2 = makeLogEntry("/api/users/42", "l2");
      const entry3 = { id: "l3", message: "build", timestamp: Date.now(), source: "build" as const }; // no path
      const body = `${JSON.stringify(entry1)}\n${JSON.stringify(entry2)}\n${JSON.stringify(entry3)}`;

      const response = await POST(createRequest(workspace.slug, body));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.processed).toBe(3);
      // matched = all entries where processLogEntry returned success: true
      // (entry1: path match ✓, entry2: path match ✓, entry3: no path → success: true)
      expect(data.matched).toBe(3);
      expect(data.highlighted).toBe(2);

      expect(mockedPusherServer.trigger).toHaveBeenCalledTimes(2);
      expect(mockedPusherServer.trigger).toHaveBeenCalledWith(
        `workspace-${workspace.slug}`,
        "highlight-nodes",
        expect.objectContaining({ nodeIds: ["endpoint-health"] }),
      );
      expect(mockedPusherServer.trigger).toHaveBeenCalledWith(
        `workspace-${workspace.slug}`,
        "highlight-nodes",
        expect.objectContaining({ nodeIds: ["endpoint-users"] }),
      );
    });
  });
});
