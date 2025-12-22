import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/graph/nodes/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  generateUniqueSlug,
  createGetRequest,
} from "@/__tests__/support/helpers";
import { EncryptionService } from "@/lib/encryption";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Mock S3Service
vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => ({
    generatePresignedDownloadUrlForBucket: vi.fn(async (bucket: string, key: string) => 
      `https://presigned-url.example.com/${bucket}/${key}?expires=3600`
    ),
  })),
}));

describe("Graph Nodes API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces/[slug]/graph/nodes", () => {
    describe("Authentication", () => {
      test("returns 401 when no session exists", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/test-slug/graph/nodes"
        );

        const response = await GET(request, {
          params: Promise.resolve({ slug: "test-slug" }),
        });

        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.message).toBe("Unauthorized");
      });

      test("returns 401 when userId is missing from session", async () => {
        const invalidSession = {
          user: { email: "test@example.com" },
          expires: new Date(Date.now() + 86400000).toISOString(),
        };

        getMockedSession().mockResolvedValue(invalidSession);

        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/test-slug/graph/nodes"
        );

        const response = await GET(request, {
          params: Promise.resolve({ slug: "test-slug" }),
        });

        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.message).toBe("Invalid user session");
      });
    });

    describe("Workspace Access Control", () => {
      test("returns 404 when workspace does not exist", async () => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            "http://localhost:3000/api/workspaces/nonexistent-slug/graph/nodes"
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: "nonexistent-slug" }),
          });

          expect(response.status).toBe(404);
          const data = await response.json();
          expect(data.success).toBe(false);
          expect(data.message).toContain("Workspace not found or access denied");
        } finally {
          await db.user.delete({ where: { id: user.id } });
        }
      });

      test("returns 404 when user is not workspace member", async () => {
        const owner = await createTestUser();
        const nonMember = await createTestUser({ email: "nonmember@example.com" });
        const workspace = await createTestWorkspace({ ownerId: owner.id });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(404);
          const data = await response.json();
          expect(data.success).toBe(false);
          expect(data.message).toContain("Workspace not found or access denied");
        } finally {
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.deleteMany({ where: { id: { in: [owner.id, nonMember.id] } } });
        }
      });

      test("returns 404 when workspace is soft-deleted", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: user.id });

        await db.workspace.update({
          where: { id: workspace.id },
          data: { deleted: true, deletedAt: new Date() },
        });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(404);
          const data = await response.json();
          expect(data.success).toBe(false);
          expect(data.message).toContain("Workspace not found or access denied");
        } finally {
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: user.id } });
        }
      });
    });

    describe("Swarm Configuration Validation", () => {
      test("returns 404 when swarm does not exist for workspace", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: user.id });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(404);
          const data = await response.json();
          expect(data.success).toBe(false);
          expect(data.message).toContain("Swarm not found for this workspace");
        } finally {
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: user.id } });
        }
      });

      test("returns 400 when swarmUrl is missing", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: user.id });
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", "test-api-key"));

        await db.swarm.create({
          data: {
            name: generateUniqueSlug("test-swarm"),
            workspaceId: workspace.id,
            swarmUrl: null,
            swarmApiKey: encryptedApiKey,
          },
        });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(400);
          const data = await response.json();
          expect(data.success).toBe(false);
          expect(data.message).toContain("Swarm configuration is incomplete");
        } finally {
          await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: user.id } });
        }
      });

      test("returns 400 when swarmApiKey is missing", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: user.id });

        await db.swarm.create({
          data: {
            name: generateUniqueSlug("test-swarm"),
            workspaceId: workspace.id,
            swarmUrl: "https://test-swarm.example.com",
            swarmApiKey: null,
          },
        });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(400);
          const data = await response.json();
          expect(data.success).toBe(false);
          expect(data.message).toContain("Swarm configuration is incomplete");
        } finally {
          await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: user.id } });
        }
      });
    });

    describe("Query Parameters", () => {
      test("accepts node_type parameter for filtering", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: user.id });
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", "test-api-key"));

        await db.swarm.create({
          data: {
            name: generateUniqueSlug("test-swarm"),
            workspaceId: workspace.id,
            swarmUrl: "https://test-swarm.example.com",
            swarmApiKey: encryptedApiKey,
          },
        });

        // Mock successful swarm API response
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            nodes: [
              { id: "node1", name: "TestFile.ts", type: "file" },
            ],
            edges: [],
          }),
        });
        global.fetch = mockFetch;

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`,
            { node_type: "file" }
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          const data = await expectSuccess(response, 200);
          expect(data.success).toBe(true);
          expect(data.data.nodes).toBeDefined();
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining("node_types=file"),
            expect.any(Object)
          );
        } finally {
          await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: user.id } });
        }
      });

      test("accepts ref_ids parameter for filtering specific nodes", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: user.id });
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", "test-api-key"));

        await db.swarm.create({
          data: {
            name: generateUniqueSlug("test-swarm"),
            workspaceId: workspace.id,
            swarmUrl: "https://test-swarm.example.com",
            swarmApiKey: encryptedApiKey,
          },
        });

        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            nodes: [
              { id: "node1", name: "TestFile.ts", type: "file" },
            ],
            edges: [],
          }),
        });
        global.fetch = mockFetch;

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`,
            { ref_ids: "node1,node2" }
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          const data = await expectSuccess(response, 200);
          expect(data.success).toBe(true);
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining("ref_ids=node1%2Cnode2"),
            expect.any(Object)
          );
        } finally {
          await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: user.id } });
        }
      });

      test("applies default values for limit and limit_mode", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: user.id });
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", "test-api-key"));

        await db.swarm.create({
          data: {
            name: generateUniqueSlug("test-swarm"),
            workspaceId: workspace.id,
            swarmUrl: "https://test-swarm.example.com",
            swarmApiKey: encryptedApiKey,
          },
        });

        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ nodes: [], edges: [] }),
        });
        global.fetch = mockFetch;

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          await expectSuccess(response, 200);
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining("limit=100"),
            expect.any(Object)
          );
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining("limit_mode=per_type"),
            expect.any(Object)
          );
        } finally {
          await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: user.id } });
        }
      });

      test("transforms node_type JSON array to comma-separated string", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: user.id });
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", "test-api-key"));

        await db.swarm.create({
          data: {
            name: generateUniqueSlug("test-swarm"),
            workspaceId: workspace.id,
            swarmUrl: "https://test-swarm.example.com",
            swarmApiKey: encryptedApiKey,
          },
        });

        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ nodes: [], edges: [] }),
        });
        global.fetch = mockFetch;

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`,
            { node_type: JSON.stringify(["file", "function"]) }
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          await expectSuccess(response, 200);
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining("node_types=file%2Cfunction"),
            expect.any(Object)
          );
        } finally {
          await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: user.id } });
        }
      });
    });

    describe("External API Integration", () => {
      test("returns nodes and edges from swarm service", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: user.id });
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", "test-api-key"));

        await db.swarm.create({
          data: {
            name: generateUniqueSlug("test-swarm"),
            workspaceId: workspace.id,
            swarmUrl: "https://test-swarm.example.com",
            swarmApiKey: encryptedApiKey,
          },
        });

        const mockNodes = [
          { id: "node1", name: "TestFile.ts", type: "file" },
          { id: "node2", name: "testFunction", type: "function" },
        ];
        const mockEdges = [
          { id: "edge1", source: "node1", target: "node2", type: "imports" },
        ];

        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ nodes: mockNodes, edges: mockEdges }),
        });
        global.fetch = mockFetch;

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          const data = await expectSuccess(response, 200);
          expect(data.success).toBe(true);
          expect(data.data.nodes).toHaveLength(2);
          expect(data.data.edges).toHaveLength(1);
          expect(data.data.nodes[0].name).toBe("TestFile.ts");
          expect(data.data.edges[0].type).toBe("imports");
        } finally {
          await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: user.id } });
        }
      });

      test("handles swarm API error responses", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: user.id });
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", "test-api-key"));

        await db.swarm.create({
          data: {
            name: generateUniqueSlug("test-swarm"),
            workspaceId: workspace.id,
            swarmUrl: "https://test-swarm.example.com",
            swarmApiKey: encryptedApiKey,
          },
        });

        const mockFetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          json: async () => ({ error: "Service unavailable" }),
        });
        global.fetch = mockFetch;

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          expect(response.status).toBe(503);
          const data = await response.json();
          expect(data.success).toBe(false);
          expect(data.message).toBe("Failed to fetch graph nodes");
        } finally {
          await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: user.id } });
        }
      });

      test("returns empty arrays when swarm has no graph data", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: user.id });
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", "test-api-key"));

        await db.swarm.create({
          data: {
            name: generateUniqueSlug("test-swarm"),
            workspaceId: workspace.id,
            swarmUrl: "https://test-swarm.example.com",
            swarmApiKey: encryptedApiKey,
          },
        });

        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ nodes: [], edges: [] }),
        });
        global.fetch = mockFetch;

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          const data = await expectSuccess(response, 200);
          expect(data.success).toBe(true);
          expect(data.data.nodes).toEqual([]);
          expect(data.data.edges).toEqual([]);
        } finally {
          await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: user.id } });
        }
      });
    });

    describe("S3 Media URL Processing", () => {
      test("presigns S3 URLs for sphinx-livekit-recordings media", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: user.id });
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", "test-api-key"));

        await db.swarm.create({
          data: {
            name: generateUniqueSlug("test-swarm"),
            workspaceId: workspace.id,
            swarmUrl: "https://test-swarm.example.com",
            swarmApiKey: encryptedApiKey,
          },
        });

        const mockNodes = [
          {
            id: "node1",
            name: "VideoNode",
            type: "media",
            properties: {
              media_url: "https://sphinx-livekit-recordings.s3.amazonaws.com/test-video.mp4",
            },
          },
        ];

        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ nodes: mockNodes, edges: [] }),
        });
        global.fetch = mockFetch;

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          const data = await expectSuccess(response, 200);
          expect(data.success).toBe(true);
          expect(data.data.nodes[0].properties.media_url).toContain("presigned-url");
          expect(data.data.nodes[0].properties.media_url).toContain("sphinx-livekit-recordings");
        } finally {
          await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: user.id } });
        }
      });

      test("does not modify non-S3 media URLs", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: user.id });
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", "test-api-key"));

        await db.swarm.create({
          data: {
            name: generateUniqueSlug("test-swarm"),
            workspaceId: workspace.id,
            swarmUrl: "https://test-swarm.example.com",
            swarmApiKey: encryptedApiKey,
          },
        });

        const originalUrl = "https://external-media.example.com/video.mp4";
        const mockNodes = [
          {
            id: "node1",
            name: "VideoNode",
            type: "media",
            properties: { media_url: originalUrl },
          },
        ];

        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ nodes: mockNodes, edges: [] }),
        });
        global.fetch = mockFetch;

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        try {
          const request = createGetRequest(
            `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`
          );

          const response = await GET(request, {
            params: Promise.resolve({ slug: workspace.slug }),
          });

          const data = await expectSuccess(response, 200);
          expect(data.success).toBe(true);
          expect(data.data.nodes[0].properties.media_url).toBe(originalUrl);
        } finally {
          await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
          await db.workspace.delete({ where: { id: workspace.id } });
          await db.user.delete({ where: { id: user.id } });
        }
      });
    });

    describe("Role-Based Access Control", () => {
      test.each([
        { role: "OWNER", shouldAccess: true },
        { role: "ADMIN", shouldAccess: true },
        { role: "PM", shouldAccess: true },
        { role: "DEVELOPER", shouldAccess: true },
        { role: "VIEWER", shouldAccess: true },
      ] as const)(
        "user with $role role can access graph nodes",
        async ({ role, shouldAccess }) => {
          const owner = await createTestUser();
          const member = await createTestUser({ email: "member@example.com" });
          const workspace = await createTestWorkspace({ ownerId: owner.id });
          const encryptionService = EncryptionService.getInstance();
          const encryptedApiKey = JSON.stringify(encryptionService.encryptField("swarmApiKey", "test-api-key"));

          await db.swarm.create({
            data: {
              name: generateUniqueSlug("test-swarm"),
              workspaceId: workspace.id,
              swarmUrl: "https://test-swarm.example.com",
              swarmApiKey: encryptedApiKey,
            },
          });

          if (role !== "OWNER") {
            await db.workspaceMember.create({
              data: {
                workspaceId: workspace.id,
                userId: member.id,
                role,
              },
            });
          }

          const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ nodes: [], edges: [] }),
          });
          global.fetch = mockFetch;

          const testUser = role === "OWNER" ? owner : member;
          getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

          try {
            const request = createGetRequest(
              `http://localhost:3000/api/workspaces/${workspace.slug}/graph/nodes`
            );

            const response = await GET(request, {
              params: Promise.resolve({ slug: workspace.slug }),
            });

            if (shouldAccess) {
              const data = await expectSuccess(response, 200);
              expect(data.success).toBe(true);
            } else {
              expect(response.status).toBe(404);
          const data = await response.json();
          expect(data.success).toBe(false);
          expect(data.message).toContain("Workspace not found or access denied");
            }
          } finally {
            await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });
            await db.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
            await db.workspace.delete({ where: { id: workspace.id } });
            await db.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
          }
        }
      );
    });
  });
});
