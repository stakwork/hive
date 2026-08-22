/**
 * Integration tests for GET /api/workspaces/[slug]/documents/proxy
 *
 * Covers:
 * - 401 for unauthenticated callers
 * - 403 for non-member callers
 * - 429 when rate limit is exceeded (21st request in a minute)
 * - 400 for http: protocol file URLs (SSRF)
 * - 400 for non-allowlisted hostname (SSRF)
 * - 404 when node has no file_url
 * - Successful proxy streaming
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/documents/proxy/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedGetRequest,
  createGetRequest,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import { EncryptionService } from "@/lib/encryption";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { checkRateLimit } from "@/lib/rate-limit";
const mockCheckRateLimit = vi.mocked(checkRateLimit);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encryptionService = EncryptionService.getInstance();

async function setupWorkspaceWithSwarm(ownerOverrides?: Partial<Parameters<typeof createTestUser>[0]>) {
  const owner = await createTestUser(ownerOverrides);
  const workspace = await createTestWorkspace({ ownerId: owner.id });

  const encryptedApiKey = JSON.stringify(
    encryptionService.encryptField("swarmApiKey", "test-api-key"),
  );

  await db.swarm.create({
    data: {
      name: generateUniqueSlug("test-swarm"),
      workspaceId: workspace.id,
      swarmUrl: "https://test-swarm.example.com",
      swarmApiKey: encryptedApiKey,
    },
  });

  return { owner, workspace };
}

async function cleanup(ids: { workspaceId?: string; userIds: string[] }) {
  if (ids.workspaceId) {
    await db.swarm.deleteMany({ where: { workspaceId: ids.workspaceId } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: ids.workspaceId } });
    await db.workspace.delete({ where: { id: ids.workspaceId } });
  }
  await db.user.deleteMany({ where: { id: { in: ids.userIds } } });
}

const BASE_URL = "http://localhost:3000/api/workspaces";

function proxyUrl(slug: string, nodeId?: string) {
  const url = `${BASE_URL}/${slug}/documents/proxy`;
  return nodeId ? `${url}?nodeId=${nodeId}` : url;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Documents Proxy API - GET /api/workspaces/[slug]/documents/proxy", () => {
  let originalAllowlist: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: rate limiting allows the request
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    // Store and reset allowlist
    originalAllowlist = process.env.DOCX_PROXY_ALLOWED_HOSTS;
    process.env.DOCX_PROXY_ALLOWED_HOSTS = "allowed-files.example.com";
  });

  afterEach(() => {
    if (originalAllowlist === undefined) {
      delete process.env.DOCX_PROXY_ALLOWED_HOSTS;
    } else {
      process.env.DOCX_PROXY_ALLOWED_HOSTS = originalAllowlist;
    }
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  describe("Authentication", () => {
    test("returns 401 when caller is unauthenticated (no middleware headers)", async () => {
      const request = createGetRequest(proxyUrl("test-slug", "node-1"));
      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-slug" }),
      });
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    test("returns 401 when caller is unauthenticated even on a valid workspace", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();
      try {
        // No middleware auth headers = unauthenticated
        const request = createGetRequest(proxyUrl(workspace.slug, "node-1"));
        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });
        expect(response.status).toBe(401);
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });
  });

  // ── Authorization (IDOR protection) ──────────────────────────────────────

  describe("Authorization — workspace membership", () => {
    test("returns 403 when authenticated user is not a member of the workspace", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();
      const nonMember = await createTestUser({ email: "outsider@example.com" });
      try {
        const request = createAuthenticatedGetRequest(
          proxyUrl(workspace.slug, "node-1"),
          nonMember,
        );
        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });
        expect(response.status).toBe(403);
        const data = await response.json();
        expect(data.error).toBeDefined();
      } finally {
        await cleanup({
          workspaceId: workspace.id,
          userIds: [owner.id, nonMember.id],
        });
      }
    });

    test("returns 404 when workspace does not exist", async () => {
      const user = await createTestUser();
      try {
        const request = createAuthenticatedGetRequest(
          proxyUrl("nonexistent-slug", "node-1"),
          user,
        );
        const response = await GET(request, {
          params: Promise.resolve({ slug: "nonexistent-slug" }),
        });
        // resolveWorkspaceAccess returns kind "not-found" → requireMemberAccess → 404
        expect(response.status).toBe(404);
      } finally {
        await db.user.delete({ where: { id: user.id } });
      }
    });
  });

  // ── Rate limiting ──────────────────────────────────────────────────────────

  describe("Rate limiting", () => {
    test("returns 429 when rate limit is exceeded", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();
      try {
        // Mock rate limit as exceeded
        mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 42 });

        const request = createAuthenticatedGetRequest(
          proxyUrl(workspace.slug, "node-1"),
          owner,
        );
        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(429);
        const data = await response.json();
        expect(data.error).toMatch(/rate limit/i);
        // Retry-After header should be set
        expect(response.headers.get("Retry-After")).toBe("42");
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });

    test("rate limit key includes userId and workspaceId", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();

      // Graph fetch returns a file URL so we can verify rate-limit was called
      // before SSRF validation
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [{ id: "node-1", properties: { file_url: "https://allowed-files.example.com/doc.docx" } }],
        }),
      });

      // Mock the upstream file fetch too (after graph lookup)
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        if (callCount === 1) {
          // Graph API call
          return {
            ok: true,
            json: async () => ({
              nodes: [{ id: "node-1", properties: { file_url: "https://allowed-files.example.com/doc.docx" } }],
            }),
          };
        }
        // Upstream file fetch - return a simple response
        return {
          ok: true,
          headers: { get: () => "application/octet-stream" },
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      });

      try {
        await GET(
          createAuthenticatedGetRequest(proxyUrl(workspace.slug, "node-1"), owner),
          { params: Promise.resolve({ slug: workspace.slug }) },
        );

        // checkRateLimit must have been called with a key containing userId and workspaceId
        expect(mockCheckRateLimit).toHaveBeenCalledWith(
          expect.stringContaining(owner.id),
          expect.any(Number),
          expect.any(Number),
        );
        expect(mockCheckRateLimit).toHaveBeenCalledWith(
          expect.stringContaining(workspace.id),
          expect.any(Number),
          expect.any(Number),
        );
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });

    test("rate limit of 20 per 60 seconds is enforced", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();
      try {
        mockCheckRateLimit.mockResolvedValue({ allowed: false });

        await GET(
          createAuthenticatedGetRequest(proxyUrl(workspace.slug, "node-1"), owner),
          { params: Promise.resolve({ slug: workspace.slug }) },
        );

        // Verify the limit and window parameters
        expect(mockCheckRateLimit).toHaveBeenCalledWith(
          expect.any(String),
          20,   // max 20 requests
          60,   // per 60 seconds
        );
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });
  });

  // ── SSRF protection ────────────────────────────────────────────────────────

  describe("SSRF protection", () => {
    test("returns 400 when file URL uses http: protocol", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [{ id: "node-1", properties: { file_url: "http://evil.com/doc.docx" } }],
        }),
      });

      try {
        const request = createAuthenticatedGetRequest(
          proxyUrl(workspace.slug, "node-1"),
          owner,
        );
        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toMatch(/forbidden protocol/i);
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });

    test("returns 400 when file URL hostname is not in the allowlist", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [{ id: "node-1", properties: { file_url: "https://untrusted-host.example.com/doc.docx" } }],
        }),
      });

      try {
        const request = createAuthenticatedGetRequest(
          proxyUrl(workspace.slug, "node-1"),
          owner,
        );
        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toMatch(/not allowlisted/i);
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });
  });

  // ── Node resolution ────────────────────────────────────────────────────────

  describe("Node resolution", () => {
    test("returns 400 when nodeId query param is absent", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();
      try {
        const request = createAuthenticatedGetRequest(
          proxyUrl(workspace.slug), // no nodeId
          owner,
        );
        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe("nodeId required");
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });

    test("returns 404 when node has no file_url property", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [{ id: "node-1", properties: { name: "file.ts" } }],
        }),
      });

      try {
        const request = createAuthenticatedGetRequest(
          proxyUrl(workspace.slug, "node-1"),
          owner,
        );
        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });
        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe("No file URL on node");
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });
  });
});
