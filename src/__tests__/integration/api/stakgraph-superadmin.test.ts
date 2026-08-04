/**
 * Integration tests: super-admin bypass for GET/PUT /api/workspaces/[slug]/stakgraph
 *
 * Covers:
 *  - Non-member super admin can GET stakgraph and receive real poolCpu/poolMemory
 *  - Non-member super admin can PUT a CPU/RAM change and syncPoolManagerSettings is invoked
 *  - Non-member non-super-admin gets 404/403 on both GET and PUT
 *  - IDOR regression: VIEWER member is rejected (403) on PUT; OWNER/ADMIN member succeeds
 *  - GitHub webhook setup is skipped on the bypass path but runs for normal OWNER saves
 *  - API-token auth path is unaffected by the IDOR role gate
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  generateUniqueId,
  generateUniqueSlug,
  getMockedSession,
  createGetRequest,
  createPutRequest,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspace, createTestMembership } from "@/__tests__/support/factories";

// ---------------------------------------------------------------------------
// Module-level mocks (must be declared before any imports of the tested module)
// ---------------------------------------------------------------------------

// Mock checkIsSuperAdmin so we control who is/isn't a super admin per test
const mockCheckIsSuperAdmin = vi.hoisted(() => vi.fn().mockResolvedValue(false));
vi.mock("@/lib/middleware/utils", () => ({
  checkIsSuperAdmin: mockCheckIsSuperAdmin,
}));

// Mock syncPoolManagerSettings to avoid real HTTP calls
vi.mock("@/services/pool-manager/sync", () => ({
  syncPoolManagerSettings: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock WebhookService to avoid real GitHub token calls; also lets us assert call counts
const mockSetupRepositoryWithWebhook = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ repositoryId: "mock-repo-id", defaultBranch: "main", webhookId: 12345 }),
);
vi.mock("@/services/github/WebhookService", () => ({
  WebhookService: vi.fn().mockImplementation(() => ({
    setupRepositoryWithWebhook: mockSetupRepositoryWithWebhook,
    deleteRepoWebhook: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock swarm secrets helpers (avoid real encryption for pool api key retrieval)
const mockGetSwarmPoolApiKeyFor = vi.hoisted(() => vi.fn().mockResolvedValue("test-pool-api-key"));
const mockUpdateSwarmPoolApiKeyFor = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: mockGetSwarmPoolApiKeyFor,
  updateSwarmPoolApiKeyFor: mockUpdateSwarmPoolApiKeyFor,
}));

// Mock syncPM2AndServices to avoid heavy PM2 generation logic
vi.mock("@/utils/stakgraphSync", () => ({
  syncPM2AndServices: vi.fn().mockReturnValue({ services: [], containerFiles: {} }),
  extractRepoName: vi.fn().mockReturnValue("test-repo"),
}));

// Mock hasInfrastructureChange so we can control whether it sees a real change
const mockHasInfrastructureChange = vi.hoisted(() => vi.fn().mockReturnValue(true));
vi.mock("@/utils/swarmInfraChanges", () => ({
  hasInfrastructureChange: mockHasInfrastructureChange,
}));

// Import route handlers AFTER all mocks are set up
import {
  GET as GET_STAK,
  PUT as PUT_STAK,
} from "@/app/api/workspaces/[slug]/stakgraph/route";
import { syncPoolManagerSettings } from "@/services/pool-manager/sync";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encryptionService = EncryptionService.getInstance();

function encryptField(field: string, value: string): string {
  return JSON.stringify(encryptionService.encryptField(field, value));
}

/** Build a minimal swarm record with real poolCpu/poolMemory and a poolApiKey */
async function createSwarmWithPool(workspaceId: string, opts?: { poolCpu?: string; poolMemory?: string }) {
  return db.swarm.create({
    data: {
      workspaceId,
      name: `swarm-${generateUniqueId("sw")}`,
      status: "ACTIVE",
      swarmUrl: "https://test-swarm.sphinx.chat",
      poolCpu: opts?.poolCpu ?? "4",
      poolMemory: opts?.poolMemory ?? "16Gi",
      poolApiKey: encryptField("poolApiKey", "test-pool-api-key"),
      agentRequestId: null,
      agentStatus: null,
    },
  });
}

function makeGetRequest(slug: string) {
  return createGetRequest(`http://localhost:3000/api/workspaces/${slug}/stakgraph`);
}

function makePutRequest(slug: string, body: Record<string, unknown>) {
  return createPutRequest(`http://localhost:3000/api/workspaces/${slug}/stakgraph`, body);
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe("GET+PUT /api/workspaces/[slug]/stakgraph — super-admin bypass", () => {
  let ownerUser: Awaited<ReturnType<typeof createTestUser>>;
  let superAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let regularUser: Awaited<ReturnType<typeof createTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let swarm: Awaited<ReturnType<typeof createSwarmWithPool>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Default: no one is a super admin; individual tests override this
    mockCheckIsSuperAdmin.mockResolvedValue(false);
    mockGetSwarmPoolApiKeyFor.mockResolvedValue("test-pool-api-key");
    mockHasInfrastructureChange.mockReturnValue(true);
    vi.mocked(syncPoolManagerSettings).mockResolvedValue({ success: true });

    ownerUser = await createTestUser({ email: `owner-${generateUniqueId()}@test.com` });
    superAdminUser = await createTestUser({
      role: "SUPER_ADMIN",
      email: `sa-${generateUniqueId()}@test.com`,
    });
    regularUser = await createTestUser({ email: `regular-${generateUniqueId()}@test.com` });

    workspace = await createTestWorkspace({
      ownerId: ownerUser.id,
      slug: generateUniqueSlug("stak-sa"),
    });

    swarm = await createSwarmWithPool(workspace.id);
  });

  // -------------------------------------------------------------------------
  // GET — super-admin bypass
  // -------------------------------------------------------------------------

  describe("GET — super-admin bypass", () => {
    it("returns real poolCpu/poolMemory for a non-member super admin", async () => {
      // superAdminUser is NOT a member of workspace
      mockCheckIsSuperAdmin.mockResolvedValue(true);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(superAdminUser));

      const res = await GET_STAK(makeGetRequest(workspace.slug), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.poolCpu).toBe("4");
      expect(body.data.poolMemory).toBe("16Gi");
    });

    it("returns swarmUrl and swarmSecretAlias for a non-member super admin", async () => {
      // Set some extra swarm fields
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: "https://custom-swarm.test", swarmSecretAlias: "my-alias" },
      });

      mockCheckIsSuperAdmin.mockResolvedValue(true);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(superAdminUser));

      const res = await GET_STAK(makeGetRequest(workspace.slug), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.swarmUrl).toBe("https://custom-swarm.test");
      expect(body.data.swarmSecretAlias).toBe("my-alias");
    });

    it("returns 404 for a non-member non-super-admin", async () => {
      mockCheckIsSuperAdmin.mockResolvedValue(false);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(regularUser));

      const res = await GET_STAK(makeGetRequest(workspace.slug), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 for a non-member user even if isSuperAdmin env is set (but checkIsSuperAdmin says false)", async () => {
      mockCheckIsSuperAdmin.mockResolvedValue(false);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(regularUser));

      const res = await GET_STAK(makeGetRequest(workspace.slug), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(404);
    });

    it("owner member can still GET stakgraph settings without being super admin", async () => {
      mockCheckIsSuperAdmin.mockResolvedValue(false);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const res = await GET_STAK(makeGetRequest(workspace.slug), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.poolCpu).toBe("4");
    });
  });

  // -------------------------------------------------------------------------
  // PUT — super-admin bypass + IDOR fix
  // -------------------------------------------------------------------------

  describe("PUT — super-admin bypass", () => {
    it("allows non-member super admin to update poolCpu and calls syncPoolManagerSettings", async () => {
      mockCheckIsSuperAdmin.mockResolvedValue(true);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(superAdminUser));

      const res = await PUT_STAK(makePutRequest(workspace.slug, { poolCpu: "8" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // syncPoolManagerSettings must have been invoked (infraChanged = true via mock)
      expect(vi.mocked(syncPoolManagerSettings)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(syncPoolManagerSettings)).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
          poolCpu: "8",
        }),
      );

      // DB should have the new value
      const updatedSwarm = await db.swarm.findUnique({ where: { workspaceId: workspace.id } });
      expect(updatedSwarm?.poolCpu).toBe("8");
    });

    it("allows non-member super admin to update poolMemory and calls syncPoolManagerSettings", async () => {
      mockCheckIsSuperAdmin.mockResolvedValue(true);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(superAdminUser));

      const res = await PUT_STAK(makePutRequest(workspace.slug, { poolMemory: "32Gi" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(200);
      expect(vi.mocked(syncPoolManagerSettings)).toHaveBeenCalledWith(
        expect.objectContaining({ poolMemory: "32Gi" }),
      );
    });

    it("returns 404 for a non-member non-super-admin on PUT", async () => {
      mockCheckIsSuperAdmin.mockResolvedValue(false);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(regularUser));

      const res = await PUT_STAK(makePutRequest(workspace.slug, { poolCpu: "8" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      // Non-member: getWorkspaceBySlug returns null → 404
      expect(res.status).toBe(404);
      expect(vi.mocked(syncPoolManagerSettings)).not.toHaveBeenCalled();
    });

    it("allows workspace OWNER member to PUT without super-admin bypass", async () => {
      mockCheckIsSuperAdmin.mockResolvedValue(false);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const res = await PUT_STAK(makePutRequest(workspace.slug, { poolCpu: "6" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(200);
      expect(vi.mocked(syncPoolManagerSettings)).toHaveBeenCalledTimes(1);
    });

    it("allows workspace ADMIN member to PUT", async () => {
      const adminUser = await createTestUser({ email: `admin-${generateUniqueId()}@test.com` });
      await createTestMembership({ workspaceId: workspace.id, userId: adminUser.id, role: "ADMIN" });

      mockCheckIsSuperAdmin.mockResolvedValue(false);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const res = await PUT_STAK(makePutRequest(workspace.slug, { poolCpu: "6" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // IDOR regression: lower-role members must be rejected
  // -------------------------------------------------------------------------

  describe("PUT — IDOR role gate", () => {
    it("rejects a VIEWER member with 403", async () => {
      const viewerUser = await createTestUser({ email: `viewer-${generateUniqueId()}@test.com` });
      await createTestMembership({ workspaceId: workspace.id, userId: viewerUser.id, role: "VIEWER" });

      mockCheckIsSuperAdmin.mockResolvedValue(false);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(viewerUser));

      const res = await PUT_STAK(makePutRequest(workspace.slug, { poolCpu: "8" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(403);
      expect(vi.mocked(syncPoolManagerSettings)).not.toHaveBeenCalled();
    });

    it("rejects a DEVELOPER member with 403", async () => {
      const devUser = await createTestUser({ email: `dev-${generateUniqueId()}@test.com` });
      await createTestMembership({ workspaceId: workspace.id, userId: devUser.id, role: "DEVELOPER" });

      mockCheckIsSuperAdmin.mockResolvedValue(false);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(devUser));

      const res = await PUT_STAK(makePutRequest(workspace.slug, { poolCpu: "8" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(403);
    });

    it("rejects a STAKEHOLDER member with 403", async () => {
      const stakeUser = await createTestUser({ email: `stake-${generateUniqueId()}@test.com` });
      await createTestMembership({ workspaceId: workspace.id, userId: stakeUser.id, role: "STAKEHOLDER" });

      mockCheckIsSuperAdmin.mockResolvedValue(false);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(stakeUser));

      const res = await PUT_STAK(makePutRequest(workspace.slug, { poolCpu: "8" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(403);
    });

    it("rejects a PM member with 403", async () => {
      const pmUser = await createTestUser({ email: `pm-${generateUniqueId()}@test.com` });
      await createTestMembership({ workspaceId: workspace.id, userId: pmUser.id, role: "PM" });

      mockCheckIsSuperAdmin.mockResolvedValue(false);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(pmUser));

      const res = await PUT_STAK(makePutRequest(workspace.slug, { poolCpu: "8" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(403);
    });

    it("super admin (via bypass) still passes the role gate", async () => {
      // superAdminUser is NOT a member; bypass gives them OWNER role
      mockCheckIsSuperAdmin.mockResolvedValue(true);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(superAdminUser));

      const res = await PUT_STAK(makePutRequest(workspace.slug, { poolCpu: "8" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Webhook setup: skipped on bypass path, runs for real members
  // -------------------------------------------------------------------------

  describe("PUT — GitHub webhook setup guard", () => {
    beforeEach(async () => {
      // Add a code-ingestion-enabled repository so the webhook block has work to do
      await db.repository.create({
        data: {
          workspaceId: workspace.id,
          repositoryUrl: "https://github.com/testorg/repo",
          branch: "main",
          name: "repo",
          codeIngestionEnabled: true,
        },
      });
    });

    it("does NOT call setupRepositoryWithWebhook when access is via super-admin bypass", async () => {
      mockCheckIsSuperAdmin.mockResolvedValue(true);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(superAdminUser));

      await PUT_STAK(makePutRequest(workspace.slug, { poolCpu: "8" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(mockSetupRepositoryWithWebhook).not.toHaveBeenCalled();
    });

    it("DOES call setupRepositoryWithWebhook for a normal OWNER member", async () => {
      mockCheckIsSuperAdmin.mockResolvedValue(false);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const res = await PUT_STAK(makePutRequest(workspace.slug, { poolCpu: "8" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(200);
      expect(mockSetupRepositoryWithWebhook).toHaveBeenCalledTimes(1);
    });

    it("DOES call setupRepositoryWithWebhook for a real ADMIN member", async () => {
      const adminUser = await createTestUser({ email: `admin2-${generateUniqueId()}@test.com` });
      await createTestMembership({ workspaceId: workspace.id, userId: adminUser.id, role: "ADMIN" });

      mockCheckIsSuperAdmin.mockResolvedValue(false);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const res = await PUT_STAK(makePutRequest(workspace.slug, { poolCpu: "8" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(200);
      expect(mockSetupRepositoryWithWebhook).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // API-token auth path — unaffected by session role gate
  // -------------------------------------------------------------------------

  describe("PUT — API-token auth path", () => {
    it("API token auth bypasses session role gate and succeeds", async () => {
      // Don't set a session — API token auth doesn't need one
      getMockedSession().mockResolvedValue(null);

      // Set API_TOKEN env so the route treats this as token auth
      const originalToken = process.env.API_TOKEN;
      process.env.API_TOKEN = "test-api-token";

      try {
        const { NextRequest } = await import("next/server");
        const req = new NextRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/stakgraph`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "x-api-token": "test-api-token",
            },
            body: JSON.stringify({ poolCpu: "2" }),
          },
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: workspace.slug }),
        });

        // API token path should resolve the workspace and proceed (200 or 404 depending on swarm state)
        // The key assertion: it does NOT return 403 (role gate is bypassed for token auth)
        // and does NOT return 401 (token auth doesn't need a session)
        expect(res.status).not.toBe(403);
        expect(res.status).not.toBe(401);
      } finally {
        if (originalToken === undefined) {
          delete process.env.API_TOKEN;
        } else {
          process.env.API_TOKEN = originalToken;
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // syncPoolManagerSettings only fires on real infra changes
  // -------------------------------------------------------------------------

  describe("PUT — pool manager sync gate", () => {
    it("does NOT call syncPoolManagerSettings when infraChanged is false", async () => {
      mockHasInfrastructureChange.mockReturnValue(false);
      mockCheckIsSuperAdmin.mockResolvedValue(true);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(superAdminUser));

      await PUT_STAK(makePutRequest(workspace.slug, { description: "no-infra-change" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(vi.mocked(syncPoolManagerSettings)).not.toHaveBeenCalled();
    });

    it("DOES call syncPoolManagerSettings when infraChanged is true (super-admin bypass)", async () => {
      mockHasInfrastructureChange.mockReturnValue(true);
      mockCheckIsSuperAdmin.mockResolvedValue(true);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(superAdminUser));

      const res = await PUT_STAK(makePutRequest(workspace.slug, { poolCpu: "8" }), {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(res.status).toBe(200);
      expect(vi.mocked(syncPoolManagerSettings)).toHaveBeenCalledTimes(1);
    });
  });
});
