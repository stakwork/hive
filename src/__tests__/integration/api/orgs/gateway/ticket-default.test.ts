/**
 * Integration tests for two-phase default-workspace lookup in
 * POST /api/orgs/[githubLogin]/gateway/ticket
 *
 * The actual gateway fetch is mocked — these tests verify that the
 * route picks the correct workspace (default vs first-reachable).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createAuthenticatedPostRequest, generateUniqueId } from "@/__tests__/support/helpers";
import { createTestUser, createTestSwarm } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";
import { POST } from "@/app/api/orgs/[githubLogin]/gateway/ticket/route";
import type { NextResponse } from "next/server";

// ─── Mock external services ───────────────────────────────────────────────────

// Mock EncryptionService so we don't need real KEY env vars.
// Both encryptField (used by createTestSwarm factory) and
// decryptField (used by the route handler) must be mocked.
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      encryptField: (_field: string, value: string) => ({ encrypted: value }),
      decryptField: (_field: string, _value: string) => "mock-provisioning-token",
    }),
  },
}));

// Mock deriveBifrostBaseUrl
vi.mock("@/services/bifrost/resolve", () => ({
  deriveBifrostBaseUrl: (swarmUrl: string) => swarmUrl.replace(/\/api$/, ""),
}));

// ─── helpers ─────────────────────────────────────────────────────────────────

async function expectJson<T = unknown>(res: NextResponse | Response, status = 200): Promise<T> {
  const r = res as Response;
  expect(r.status).toBe(status);
  return r.json() as Promise<T>;
}

let installationIdCounter = 760000;
function nextInstallationId() {
  return installationIdCounter++;
}

async function createOrg(githubLogin: string) {
  return db.sourceControlOrg.create({
    data: {
      githubLogin,
      githubInstallationId: nextInstallationId(),
      type: "ORG",
      name: githubLogin,
    },
  });
}

async function createWorkspaceInOrg(ownerId: string, orgId: string, suffix = "") {
  const slug = `gw-test-ws-${generateUniqueId()}${suffix}`;
  return db.workspace.create({
    data: { name: slug, slug, ownerId, sourceControlOrgId: orgId },
  });
}

function makeParams(githubLogin: string) {
  return Promise.resolve({ githubLogin });
}

// ─── cleanup ─────────────────────────────────────────────────────────────────

const createdOrgIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdWorkspaceIds.length > 0) {
    await db.workspaceMember.deleteMany({
      where: { workspaceId: { in: createdWorkspaceIds } },
    });
    await db.swarm.deleteMany({
      where: { workspaceId: { in: createdWorkspaceIds } },
    });
    await db.sourceControlOrg.updateMany({
      where: { defaultWorkspaceId: { in: createdWorkspaceIds } },
      data: { defaultWorkspaceId: null },
    });
    await db.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    createdWorkspaceIds.length = 0;
  }
  if (createdOrgIds.length > 0) {
    await db.sourceControlOrg.deleteMany({ where: { id: { in: createdOrgIds } } });
    createdOrgIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
  vi.restoreAllMocks();
});

// Mock global fetch before each test
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ticket: "mock-ticket-abc" }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe("POST /api/orgs/[githubLogin]/gateway/ticket — two-phase workspace lookup", () => {
  it("returns ticket from default workspace when set, accessible, and swarm configured", async () => {
    const githubLogin = `gw-org-default-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const owner = await createTestUser({
      email: `gw-owner-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);

    // Fallback workspace (created first — would be returned by original query)
    const fallbackWs = await createWorkspaceInOrg(owner.id, org.id, "-fallback");
    createdWorkspaceIds.push(fallbackWs.id);
    await createTestSwarm({
      workspaceId: fallbackWs.id,
      swarmUrl: "https://fallback.swarm.test/api",
      swarmApiKey: "key-fallback",
    });

    // Default workspace
    const defaultWs = await createWorkspaceInOrg(owner.id, org.id, "-default");
    createdWorkspaceIds.push(defaultWs.id);
    await createTestSwarm({
      workspaceId: defaultWs.id,
      swarmUrl: "https://default.swarm.test/api",
      swarmApiKey: "key-default",
    });

    // Set the default
    await db.sourceControlOrg.update({
      where: { id: org.id },
      data: { defaultWorkspaceId: defaultWs.id },
    });

    const req = createAuthenticatedPostRequest(
      `/api/orgs/${githubLogin}/gateway/ticket`,
      {},
      { id: owner.id, email: owner.email!, name: owner.name! },
    );
    const res = await POST(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ url: string; ticket: string }>(res, 200);

    expect(data.ticket).toBe("mock-ticket-abc");
    // The fetch call should target the default workspace's swarm URL
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("default.swarm.test"),
      expect.any(Object),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("fallback.swarm.test"),
      expect.any(Object),
    );
  });

  it("falls through to first-reachable when default workspace has no swarm", async () => {
    const githubLogin = `gw-org-noswarm-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const owner = await createTestUser({
      email: `gw-owner-ns-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);

    // Default workspace — NO swarm
    const defaultWs = await createWorkspaceInOrg(owner.id, org.id, "-noswarm");
    createdWorkspaceIds.push(defaultWs.id);
    // No swarm created for defaultWs

    // Fallback workspace with swarm
    const fallbackWs = await createWorkspaceInOrg(owner.id, org.id, "-fallback");
    createdWorkspaceIds.push(fallbackWs.id);
    await createTestSwarm({
      workspaceId: fallbackWs.id,
      swarmUrl: "https://fallback2.swarm.test/api",
      swarmApiKey: "key-fallback2",
    });

    await db.sourceControlOrg.update({
      where: { id: org.id },
      data: { defaultWorkspaceId: defaultWs.id },
    });

    const req = createAuthenticatedPostRequest(
      `/api/orgs/${githubLogin}/gateway/ticket`,
      {},
      { id: owner.id, email: owner.email!, name: owner.name! },
    );
    const res = await POST(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ url: string; ticket: string }>(res, 200);

    expect(data.ticket).toBe("mock-ticket-abc");
    // Falls through to fallback swarm
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("fallback2.swarm.test"),
      expect.any(Object),
    );
  });

  it("falls through to first-reachable when caller lacks access to default workspace", async () => {
    const githubLogin = `gw-org-noaccess-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    // Owner of the default workspace
    const otherOwner = await createTestUser({
      email: `gw-other-owner-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(otherOwner.id);

    // Caller is a member of a different workspace in the same org
    const caller = await createTestUser({
      email: `gw-caller-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(caller.id);

    // Default workspace — owned by otherOwner, caller has no access
    const defaultWs = await createWorkspaceInOrg(otherOwner.id, org.id, "-restricted");
    createdWorkspaceIds.push(defaultWs.id);
    await createTestSwarm({
      workspaceId: defaultWs.id,
      swarmUrl: "https://restricted.swarm.test/api",
      swarmApiKey: "key-restricted",
    });

    // Caller's workspace with swarm
    const callerWs = await createWorkspaceInOrg(caller.id, org.id, "-caller");
    createdWorkspaceIds.push(callerWs.id);
    await createTestSwarm({
      workspaceId: callerWs.id,
      swarmUrl: "https://caller.swarm.test/api",
      swarmApiKey: "key-caller",
    });

    await db.sourceControlOrg.update({
      where: { id: org.id },
      data: { defaultWorkspaceId: defaultWs.id },
    });

    const req = createAuthenticatedPostRequest(
      `/api/orgs/${githubLogin}/gateway/ticket`,
      {},
      { id: caller.id, email: caller.email!, name: caller.name! },
    );
    const res = await POST(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ url: string; ticket: string }>(res, 200);

    expect(data.ticket).toBe("mock-ticket-abc");
    // Falls through to caller's own workspace
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("caller.swarm.test"),
      expect.any(Object),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("restricted.swarm.test"),
      expect.any(Object),
    );
  });

  it("returns first-reachable workspace when no default is set", async () => {
    const githubLogin = `gw-org-nodefault-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const owner = await createTestUser({
      email: `gw-owner-nd-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({
      workspaceId: ws.id,
      swarmUrl: "https://only.swarm.test/api",
      swarmApiKey: "key-only",
    });

    // No defaultWorkspaceId set on org

    const req = createAuthenticatedPostRequest(
      `/api/orgs/${githubLogin}/gateway/ticket`,
      {},
      { id: owner.id, email: owner.email!, name: owner.name! },
    );
    const res = await POST(req, { params: makeParams(githubLogin) });
    const data = await expectJson<{ url: string; ticket: string }>(res, 200);

    expect(data.ticket).toBe("mock-ticket-abc");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("only.swarm.test"),
      expect.any(Object),
    );
  });

  it("returns 404 when no swarm is configured in any workspace for this org", async () => {
    const githubLogin = `gw-org-noswarms-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);

    const owner = await createTestUser({
      email: `gw-owner-nsa-${generateUniqueId()}@example.com`,
      idempotent: false,
    });
    createdUserIds.push(owner.id);

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    // No swarm created

    const req = createAuthenticatedPostRequest(
      `/api/orgs/${githubLogin}/gateway/ticket`,
      {},
      { id: owner.id, email: owner.email!, name: owner.name! },
    );
    const res = await POST(req, { params: makeParams(githubLogin) });
    await expectJson(res, 404);
  });
});
