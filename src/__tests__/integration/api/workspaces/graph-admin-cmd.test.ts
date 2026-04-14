import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/workspaces/[slug]/graph-admin/cmd/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
  createTestSwarm,
} from "@/__tests__/support/factories";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createPostRequest } from "@/__tests__/support/helpers/request-builders";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/services/swarm/cmd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/swarm/cmd")>();
  return {
    ...actual,
    getSwarmCmdJwt: vi.fn(),
    swarmCmdRequest: vi.fn(),
  };
});

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,mockqr"),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(slug: string, body: object) {
  return createPostRequest(
    `http://localhost:3000/api/workspaces/${slug}/graph-admin/cmd`,
    body,
  );
}

async function callRoute(slug: string, body: object) {
  const request = makeRequest(slug, body);
  return POST(request as any, { params: Promise.resolve({ slug }) });
}

const GRAPH_ADMIN_CMDS = [
  { type: "Swarm", data: { cmd: "GetBoltwallAccessibility" } },
  { type: "Swarm", data: { cmd: "UpdateBoltwallAccessibility", content: true } },
  { type: "Swarm", data: { cmd: "ListPaidEndpoint" } },
  { type: "Swarm", data: { cmd: "UpdatePaidEndpoint", content: { id: 1, status: false } } },
] as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/graph-admin/cmd", () => {
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let nonAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let nonGraphWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  const createdEntityIds = {
    userIds: [] as string[],
    workspaceIds: [] as string[],
    swarmIds: [] as string[],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    getMockedSession().mockResolvedValue(null);

    owner = await createTestUser({ email: `graph-admin-owner-${Date.now()}@test.com` });
    nonAdminUser = await createTestUser({ email: `graph-admin-viewer-${Date.now()}@test.com` });
    createdEntityIds.userIds.push(owner.id, nonAdminUser.id);

    workspace = await createTestWorkspace({
      ownerId: owner.id,
      slug: `graph-admin-test-${Date.now()}`,
      name: "Graph Admin Test Workspace",
    });
    await db.workspace.update({
      where: { id: workspace.id },
      data: { workspaceKind: "graph_mindset" },
    });
    createdEntityIds.workspaceIds.push(workspace.id);

    // Owner is implicitly the workspace owner — add them as OWNER member so
    // validateWorkspaceAccess recognises admin access
    await createTestMembership({
      workspaceId: workspace.id,
      userId: owner.id,
      role: "OWNER",
    });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: nonAdminUser.id,
      role: "VIEWER",
    });

    nonGraphWorkspace = await createTestWorkspace({
      ownerId: owner.id,
      slug: `non-graph-test-${Date.now()}`,
      name: "Non Graph Workspace",
    });
    createdEntityIds.workspaceIds.push(nonGraphWorkspace.id);
    await createTestMembership({
      workspaceId: nonGraphWorkspace.id,
      userId: owner.id,
      role: "OWNER",
    });
  });

  afterEach(async () => {
    if (createdEntityIds.swarmIds.length) {
      await db.swarm.deleteMany({ where: { id: { in: createdEntityIds.swarmIds } } });
      createdEntityIds.swarmIds.length = 0;
    }
    if (createdEntityIds.workspaceIds.length) {
      await db.workspace.deleteMany({ where: { id: { in: createdEntityIds.workspaceIds } } });
      createdEntityIds.workspaceIds.length = 0;
    }
    if (createdEntityIds.userIds.length) {
      await db.user.deleteMany({ where: { id: { in: createdEntityIds.userIds } } });
      createdEntityIds.userIds.length = 0;
    }
  });

  // ── Authentication ────────────────────────────────────────────────────────

  test("returns 401 when unauthenticated", async () => {
    getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

    const response = await callRoute(workspace.slug, {
      cmd: GRAPH_ADMIN_CMDS[0],
    });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toMatch(/unauthorized/i);
  });

  // ── Authorization ─────────────────────────────────────────────────────────

  test("returns 403 when non-admin user", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(nonAdminUser));

    const response = await callRoute(workspace.slug, {
      cmd: GRAPH_ADMIN_CMDS[0],
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toMatch(/admin/i);
  });

  test("returns 403 when workspace is not graph_mindset kind", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const response = await callRoute(nonGraphWorkspace.slug, {
      cmd: GRAPH_ADMIN_CMDS[0],
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toMatch(/graphmindset/i);
  });

  // ── Missing infrastructure ────────────────────────────────────────────────

  test("returns 404 when swarm not configured", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const response = await callRoute(workspace.slug, {
      cmd: GRAPH_ADMIN_CMDS[0],
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toMatch(/swarm not configured/i);
  });

  test("returns 502 when swarm has no swarmPassword", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const swarm = await createTestSwarm({
      workspaceId: workspace.id,
      swarmUrl: `https://${workspace.slug}.sphinx.chat`,
    });
    createdEntityIds.swarmIds.push(swarm.id);

    const response = await callRoute(workspace.slug, {
      cmd: GRAPH_ADMIN_CMDS[0],
    });

    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toMatch(/swarm password not configured/i);
  });

  // ── Swarm auth failure ────────────────────────────────────────────────────

  test("returns 502 when getSwarmCmdJwt throws", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const swarm = await createTestSwarm({
      workspaceId: workspace.id,
      swarmUrl: `https://${workspace.slug}.sphinx.chat`,
      swarmPassword: "test-password",
    });
    createdEntityIds.swarmIds.push(swarm.id);

    const { getSwarmCmdJwt } = await import("@/services/swarm/cmd");
    vi.mocked(getSwarmCmdJwt).mockRejectedValue(new Error("Swarm login failed (401)"));

    const response = await callRoute(workspace.slug, {
      cmd: GRAPH_ADMIN_CMDS[0],
    });

    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toMatch(/swarm login failed/i);
  });

  // ── Success cases ─────────────────────────────────────────────────────────

  describe("200 success for all four cmd types", () => {
    let swarm: Awaited<ReturnType<typeof createTestSwarm>>;

    beforeEach(async () => {
      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: `https://${workspace.slug}.sphinx.chat`,
        swarmPassword: "test-password-123",
      });
      createdEntityIds.swarmIds.push(swarm.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { getSwarmCmdJwt, swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(getSwarmCmdJwt).mockResolvedValue("mock-jwt-token");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { success: true },
      });
    });

    test("GetBoltwallAccessibility returns 200", async () => {
      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { isPublic: false },
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "GetBoltwallAccessibility" } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.isPublic).toBe(false);

      expect(vi.mocked(swarmCmdRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          swarmUrl: swarm.swarmUrl,
          jwt: "mock-jwt-token",
          cmd: { type: "Swarm", data: { cmd: "GetBoltwallAccessibility" } },
        }),
      );
    });

    test("UpdateBoltwallAccessibility returns 200", async () => {
      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { success: true },
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "UpdateBoltwallAccessibility", content: true } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("ListPaidEndpoint returns 200", async () => {
      const endpoints = [
        { id: 1, route: "v2/search", method: "GET", status: true, fee: 10 },
      ];
      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { endpoints },
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "ListPaidEndpoint" } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.endpoints).toHaveLength(1);
    });

    test("UpdatePaidEndpoint returns 200", async () => {
      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { success: true },
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "UpdatePaidEndpoint", content: { id: 1, status: false } } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  // ── Invalid cmd ────────────────────────────────────────────────────────────

  test("returns 400 for disallowed cmd type", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const swarm = await createTestSwarm({
      workspaceId: workspace.id,
      swarmUrl: `https://${workspace.slug}.sphinx.chat`,
      swarmPassword: "test-password",
    });
    createdEntityIds.swarmIds.push(swarm.id);

    const response = await callRoute(workspace.slug, {
      cmd: { type: "Swarm", data: { cmd: "UpdateNeo4jConfig", content: {} } },
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/invalid cmd/i);
  });

  // ── Bot & User management passthroughs ────────────────────────────────────

  describe("Bot and User management passthrough cmds", () => {
    let swarm: Awaited<ReturnType<typeof createTestSwarm>>;

    beforeEach(async () => {
      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: `https://${workspace.slug}.sphinx.chat`,
        swarmPassword: "test-password-123",
      });
      createdEntityIds.swarmIds.push(swarm.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { getSwarmCmdJwt, swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(getSwarmCmdJwt).mockResolvedValue("mock-jwt-token");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { success: true },
      });
    });

    test("GetBotBalance returns 200", async () => {
      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { success: true, message: "bot balance retrieved", data: { msat: 50000 } },
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "GetBotBalance" } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ success: true, message: "bot balance retrieved", data: { msat: 50000 } });
    });

    test("AddBoltwallUser returns 200", async () => {
      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "AddBoltwallUser", content: { pubkey: "02abc123", name: "Alice", role: "member" } } },
      });
      expect(response.status).toBe(200);
    });

    test("UpdateUser returns 200", async () => {
      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "UpdateUser", content: { id: 1, pubkey: "02abc123", name: "Alice Updated", role: "sub_admin" } } },
      });
      expect(response.status).toBe(200);
    });

    test("DeleteSubAdmin returns 200", async () => {
      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "DeleteSubAdmin", content: "02abc123" } },
      });
      expect(response.status).toBe(200);
    });

    test("AddBoltwallAdminPubkey returns 200", async () => {
      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "AddBoltwallAdminPubkey", content: { pubkey: "02abc123", name: "Owner" } } },
      });
      expect(response.status).toBe(200);
    });

    test("CreateBotInvoice appends qrCodeDataUrl to response", async () => {
      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { success: true, message: "invoice created", data: { bolt11: "lnbc100n1pxyz...", payment_hash: "abc123" } },
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "CreateBotInvoice", content: { amt_msat: 100000 } } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.bolt11).toBe("lnbc100n1pxyz...");
      expect(data.qrCodeDataUrl).toMatch(/^data:image\/png/);
    });
  });

  // ── GetEnrichedBoltwallUsers ───────────────────────────────────────────────

  describe("GetEnrichedBoltwallUsers", () => {
    let swarm: Awaited<ReturnType<typeof createTestSwarm>>;
    const TEST_PUBKEY = "02abc123def456789012345678901234567890123456789012345678901234567890";

    beforeEach(async () => {
      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: `https://${workspace.slug}.sphinx.chat`,
        swarmPassword: "test-password-123",
      });
      createdEntityIds.swarmIds.push(swarm.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { getSwarmCmdJwt } = await import("@/services/swarm/cmd");
      vi.mocked(getSwarmCmdJwt).mockResolvedValue("mock-jwt-token");
    });

    test("returns 403 for non-admin (VIEWER) user", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonAdminUser));

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "GetEnrichedBoltwallUsers" } },
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toMatch(/admin/i);
    });

    test("returns enriched list with hive name when pubkey matches workspace member", async () => {
      // Create a db.user with an encrypted lightningPubkey matching the boltwall user
      // (no WorkspaceMember row needed — enrichment now uses db.user scan directly)
      const { EncryptionService } = await import("@/lib/encryption");
      const encryptionService = EncryptionService.getInstance();
      const encryptedPubkey = JSON.stringify(encryptionService.encryptField("lightningPubkey", TEST_PUBKEY));

      const hiveUser = await createTestUser({
        email: `hive-member-${Date.now()}@test.com`,
        name: "Hive Alice",
        lightningPubkey: encryptedPubkey,
      });
      createdEntityIds.userIds.push(hiveUser.id);

      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockImplementation(async ({ cmd }) => {
        const cmdName = (cmd as { data: { cmd: string } }).data.cmd;
        if (cmdName === "ListAdmins") {
          return {
            ok: true,
            status: 200,
            data: {
              data: {
                admins: [
                  { id: 1, pubkey: TEST_PUBKEY, name: "Alice", role: "member" },
                ],
              },
            },
          };
        }
        if (cmdName === "GetBoltwallSuperAdmin") {
          return {
            ok: true,
            status: 200,
            data: { success: true, data: { pubkey: "02superadmin000", name: "Super Admin" } },
          };
        }
        return { ok: true, status: 200, data: {} };
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "GetEnrichedBoltwallUsers" } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.users).toBeDefined();

      // Owner entry (super admin)
      const ownerEntry = data.users.find((u: { role: string }) => u.role === "owner");
      expect(ownerEntry).toBeDefined();
      expect(ownerEntry.pubkey).toBe("02superadmin000");
      expect(ownerEntry.name).toBe("Super Admin");

      // Member entry with hive enrichment
      const memberEntry = data.users.find((u: { pubkey: string }) => u.pubkey === TEST_PUBKEY);
      expect(memberEntry).toBeDefined();
      expect(memberEntry.hive).not.toBeNull();
      expect(memberEntry.hive.name).toBe("Hive Alice");
    });

    test("returns sentinel owner entry with pubkey null when no super admin set", async () => {
      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockImplementation(async ({ cmd }) => {
        const cmdName = (cmd as { data: { cmd: string } }).data.cmd;
        if (cmdName === "ListAdmins") {
          return {
            ok: true,
            status: 200,
            data: {
              data: {
                admins: [
                  { id: 2, pubkey: "02member111", name: "Bob", role: "member" },
                ],
              },
            },
          };
        }
        if (cmdName === "GetBoltwallSuperAdmin") {
          // No super admin set — return empty/null-like response
          return { ok: true, status: 200, data: {} };
        }
        return { ok: true, status: 200, data: {} };
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "GetEnrichedBoltwallUsers" } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      const ownerEntry = data.users.find((u: { role: string }) => u.role === "owner");
      expect(ownerEntry).toBeDefined();
      expect(ownerEntry.pubkey).toBeNull();

      // The member entry should still be present
      const memberEntry = data.users.find((u: { pubkey: string }) => u.pubkey === "02member111");
      expect(memberEntry).toBeDefined();
    });

    test("enriches owner entry using ownerId when lightningPubkey matches superAdmin pubkey", async () => {
      const { EncryptionService } = await import("@/lib/encryption");
      const encryptionService = EncryptionService.getInstance();
      const SUPER_ADMIN_PUBKEY = "02superadminfull0000000000000000000000000000000000000000000000000001";
      const encryptedOwnerPubkey = JSON.stringify(
        encryptionService.encryptField("lightningPubkey", SUPER_ADMIN_PUBKEY),
      );

      // Set the owner's lightningPubkey to the encrypted superAdmin pubkey
      await db.user.update({
        where: { id: owner.id },
        data: { lightningPubkey: encryptedOwnerPubkey, image: "https://example.com/owner.png" },
      });

      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockImplementation(async ({ cmd }) => {
        const cmdName = (cmd as { data: { cmd: string } }).data.cmd;
        if (cmdName === "ListAdmins") {
          return { ok: true, status: 200, data: { data: { admins: [] } } };
        }
        if (cmdName === "GetBoltwallSuperAdmin") {
          return {
            ok: true,
            status: 200,
            data: { success: true, data: { pubkey: SUPER_ADMIN_PUBKEY, name: "Super Owner" } },
          };
        }
        return { ok: true, status: 200, data: {} };
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "GetEnrichedBoltwallUsers" } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      const ownerEntry = data.users.find((u: { role: string }) => u.role === "owner");
      expect(ownerEntry).toBeDefined();
      expect(ownerEntry.pubkey).toBe(SUPER_ADMIN_PUBKEY);
      expect(ownerEntry.hive).not.toBeNull();
      expect(ownerEntry.hive.name).toBe(owner.name);
      expect(ownerEntry.hive.image).toBe("https://example.com/owner.png");

      // Cleanup
      await db.user.update({
        where: { id: owner.id },
        data: { lightningPubkey: null, image: null },
      });
    });

    test("returns hive null for boltwall-only user with no matching Hive account", async () => {
      const UNMATCHED_PUBKEY = "02nomatch0000000000000000000000000000000000000000000000000000000001";

      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockImplementation(async ({ cmd }) => {
        const cmdName = (cmd as { data: { cmd: string } }).data.cmd;
        if (cmdName === "ListAdmins") {
          return {
            ok: true,
            status: 200,
            data: {
              data: {
                admins: [{ id: 99, pubkey: UNMATCHED_PUBKEY, name: "Ghost User", role: "member" }],
              },
            },
          };
        }
        if (cmdName === "GetBoltwallSuperAdmin") {
          return {
            ok: true,
            status: 200,
            data: { success: true, data: { pubkey: "02superadminX", name: "Super Admin X" } },
          };
        }
        return { ok: true, status: 200, data: {} };
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "GetEnrichedBoltwallUsers" } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      const memberEntry = data.users.find((u: { pubkey: string }) => u.pubkey === UNMATCHED_PUBKEY);
      expect(memberEntry).toBeDefined();
      expect(memberEntry.hive).toBeNull();
    });

    test("deduplicates super admin pubkey from ListAdmins results", async () => {
      const SUPER_ADMIN_PUBKEY = "02superadmin999";

      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockImplementation(async ({ cmd }) => {
        const cmdName = (cmd as { data: { cmd: string } }).data.cmd;
        if (cmdName === "ListAdmins") {
          return {
            ok: true,
            status: 200,
            data: {
              data: {
                admins: [
                  // Super admin appears in both lists — should be deduplicated
                  { id: 1, pubkey: SUPER_ADMIN_PUBKEY, name: "Owner Also In List", role: "admin" },
                  { id: 2, pubkey: "02member222", name: "Carol", role: "member" },
                ],
              },
            },
          };
        }
        if (cmdName === "GetBoltwallSuperAdmin") {
          return {
            ok: true,
            status: 200,
            data: { success: true, data: { pubkey: SUPER_ADMIN_PUBKEY, name: "Owner" } },
          };
        }
        return { ok: true, status: 200, data: {} };
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "GetEnrichedBoltwallUsers" } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Super admin should appear exactly once (as owner)
      const ownerEntries = data.users.filter((u: { pubkey: string }) => u.pubkey === SUPER_ADMIN_PUBKEY);
      expect(ownerEntries).toHaveLength(1);
      expect(ownerEntries[0].role).toBe("owner");
    });
  });

  // ── GetSecondBrainAboutDetails and UpdateSecondBrainAbout ─────────────────

  describe("SecondBrain about cmds", () => {
    let swarm: Awaited<ReturnType<typeof createTestSwarm>>;

    beforeEach(async () => {
      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: `https://${workspace.slug}.sphinx.chat`,
        swarmPassword: "test-password-123",
      });
      createdEntityIds.swarmIds.push(swarm.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { getSwarmCmdJwt, swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(getSwarmCmdJwt).mockResolvedValue("mock-jwt-token");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { title: "test-graph", description: "" },
      });
    });

    test("GetSecondBrainAboutDetails returns 200 with about data", async () => {
      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "GetSecondBrainAboutDetails" } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ title: "test-graph", description: "" });
    });

    test("UpdateSecondBrainAbout returns 200", async () => {
      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { success: true },
      });

      const response = await callRoute(workspace.slug, {
        cmd: {
          type: "Swarm",
          data: { cmd: "UpdateSecondBrainAbout", content: { title: "test-title", description: "" } },
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ success: true });
    });
  });
});
