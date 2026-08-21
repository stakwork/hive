import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/documents/node/route";
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

describe("Documents Node API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────
  // Helper: creates a workspace + swarm ready for
  // graph calls and returns cleanup references.
  // ──────────────────────────────────────────────────
  async function setupWorkspaceWithSwarm(ownerOverrides?: Partial<Parameters<typeof createTestUser>[0]>) {
    const owner = await createTestUser(ownerOverrides);
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = JSON.stringify(
      encryptionService.encryptField("swarmApiKey", "test-api-key"),
    );

    const swarm = await db.swarm.create({
      data: {
        name: generateUniqueSlug("test-swarm"),
        workspaceId: workspace.id,
        swarmUrl: "https://test-swarm.example.com",
        swarmApiKey: encryptedApiKey,
      },
    });

    return { owner, workspace, swarm };
  }

  async function cleanup(ids: {
    workspaceId?: string;
    userIds: string[];
  }) {
    if (ids.workspaceId) {
      await db.swarm.deleteMany({ where: { workspaceId: ids.workspaceId } });
      await db.workspaceMember.deleteMany({ where: { workspaceId: ids.workspaceId } });
      await db.workspace.delete({ where: { id: ids.workspaceId } });
    }
    await db.user.deleteMany({ where: { id: { in: ids.userIds } } });
  }

  // ──────────────────────────────────────────────────
  // Authentication
  // ──────────────────────────────────────────────────
  describe("Authentication", () => {
    test("returns 401 when no session exists", async () => {
      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/test-slug/documents/node",
        { nodeId: "node-abc" },
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-slug" }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    test("returns 401 for an unauthenticated request even on an existing workspace", async () => {
      // An unauthenticated caller to a private workspace gets kind "unauthenticated"
      // → requireMemberAccess returns 401
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      try {
        // No middleware auth headers → unauthenticated
        const request = createGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/documents/node`,
          { nodeId: "node-abc" },
        );

        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.error).toBeDefined();
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });
  });

  // ──────────────────────────────────────────────────
  // Workspace Access Control
  // ──────────────────────────────────────────────────
  describe("Workspace Access Control", () => {
    test("returns 404 when workspace does not exist", async () => {
      const user = await createTestUser();

      try {
        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/workspaces/nonexistent-slug/documents/node",
          user,
          { nodeId: "node-abc" },
        );

        const response = await GET(request, {
          params: Promise.resolve({ slug: "nonexistent-slug" }),
        });

        // resolveWorkspaceAccess returns kind "not-found" →
        // requireMemberAccess maps it to 404
        expect(response.status).toBe(404);
      } finally {
        await db.user.delete({ where: { id: user.id } });
      }
    });

    test("returns 403 when authenticated user is not a workspace member", async () => {
      const owner = await createTestUser();
      const nonMember = await createTestUser({ email: "outsider@example.com" });
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      try {
        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/documents/node`,
          nonMember,
          { nodeId: "node-abc" },
        );

        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        // resolveWorkspaceAccess returns kind "forbidden" →
        // requireMemberAccess maps it to 403
        expect(response.status).toBe(403);
        const data = await response.json();
        expect(data.error).toBeDefined();
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id, nonMember.id] });
      }
    });
  });

  // ──────────────────────────────────────────────────
  // Input Validation
  // ──────────────────────────────────────────────────
  describe("Input Validation", () => {
    test("returns 400 when nodeId query param is absent", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();

      try {
        // No nodeId in query string
        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/documents/node`,
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

    test("returns 400 when nodeId is an empty string", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();

      try {
        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/documents/node`,
          owner,
          { nodeId: "" },
        );

        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        // Empty string is falsy — same as missing
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe("nodeId required");
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });
  });

  // ──────────────────────────────────────────────────
  // Graph Node Resolution
  // ──────────────────────────────────────────────────
  describe("Graph Node Resolution", () => {
    test("returns 404 when graph returns no nodes for the given nodeId", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], edges: [] }),
      });
      global.fetch = mockFetch;

      try {
        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/documents/node`,
          owner,
          { nodeId: "nonexistent-node" },
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

    test("returns 404 when node exists but has no file_url property", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [
            {
              id: "node-abc",
              properties: { name: "some-file.ts", node_type: "file" },
            },
          ],
          edges: [],
        }),
      });
      global.fetch = mockFetch;

      try {
        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/documents/node`,
          owner,
          { nodeId: "node-abc" },
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

    test("returns 404 when node file_url is an empty string", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [{ id: "node-abc", properties: { file_url: "" } }],
          edges: [],
        }),
      });
      global.fetch = mockFetch;

      try {
        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/documents/node`,
          owner,
          { nodeId: "node-abc" },
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

    test("returns 200 with { fileUrl } when node has a file_url property", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();

      const expectedFileUrl = "https://example.com/documents/contract.docx";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [
            {
              id: "node-abc",
              properties: {
                file_url: expectedFileUrl,
                name: "contract.docx",
                node_type: "document",
              },
            },
          ],
          edges: [],
        }),
      });
      global.fetch = mockFetch;

      try {
        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/documents/node`,
          owner,
          { nodeId: "node-abc" },
        );

        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();

        // Only fileUrl is returned — full node payload is never exposed
        expect(data).toEqual({ fileUrl: expectedFileUrl });
        expect(data).not.toHaveProperty("id");
        expect(data).not.toHaveProperty("properties");
        expect(data).not.toHaveProperty("name");
        expect(data).not.toHaveProperty("node_type");
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });

    test("passes nodeId as ref_ids param to the graph API", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();

      const expectedFileUrl = "https://example.com/documents/contract.docx";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [{ id: "node-xyz", properties: { file_url: expectedFileUrl } }],
          edges: [],
        }),
      });
      global.fetch = mockFetch;

      try {
        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/documents/node`,
          owner,
          { nodeId: "node-xyz" },
        );

        await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        // The route must forward nodeId as ref_ids to the graph endpoint
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("ref_ids=node-xyz"),
          expect.any(Object),
        );
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });

    test("returns 404 when the graph API call fails", async () => {
      const { owner, workspace } = await setupWorkspaceWithSwarm();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "Service unavailable" }),
      });
      global.fetch = mockFetch;

      try {
        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/documents/node`,
          owner,
          { nodeId: "node-abc" },
        );

        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        // Graph failure → resolveNodeFileUrl returns null → 404
        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe("No file URL on node");
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });

    test("returns 404 when swarm is not configured for the workspace", async () => {
      // Workspace with NO swarm
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      try {
        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/documents/node`,
          owner,
          { nodeId: "node-abc" },
        );

        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        // No swarm → resolveNodeFileUrl returns null → 404
        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe("No file URL on node");
      } finally {
        await cleanup({ workspaceId: workspace.id, userIds: [owner.id] });
      }
    });
  });

  // ──────────────────────────────────────────────────
  // Role-Based Access (no role restriction — all
  // workspace members must be able to access)
  // ──────────────────────────────────────────────────
  describe("Role-Based Access Control", () => {
    test.each([
      { role: "OWNER" as const },
      { role: "ADMIN" as const },
      { role: "PM" as const },
      { role: "DEVELOPER" as const },
      { role: "VIEWER" as const },
    ])("user with $role role can resolve a node file URL", async ({ role }) => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      const encryptionService = EncryptionService.getInstance();
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

      const member =
        role === "OWNER"
          ? owner
          : await createTestUser({ email: `${role.toLowerCase()}@example.com` });

      if (role !== "OWNER") {
        await db.workspaceMember.create({
          data: { workspaceId: workspace.id, userId: member.id, role },
        });
      }

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [{ id: "node-abc", properties: { file_url: "https://example.com/doc.docx" } }],
          edges: [],
        }),
      });
      global.fetch = mockFetch;

      try {
        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/documents/node`,
          member,
          { nodeId: "node-abc" },
        );

        const response = await GET(request, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toEqual({ fileUrl: "https://example.com/doc.docx" });
      } finally {
        await cleanup({
          workspaceId: workspace.id,
          userIds: role === "OWNER" ? [owner.id] : [owner.id, member.id],
        });
      }
    });
  });
});
