/**
 * Integration tests for POST /api/workspaces/[slug]/strut/embed-url
 *
 * Modelled on the org test: the mcp `/mint-token` call is mocked. These
 * tests verify the route resolves THIS workspace's own swarm (never the
 * org default), enforces the Owner/Admin role gate, and mints with the
 * short 1h TTL.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createAuthenticatedPostRequest, generateUniqueId } from "@/__tests__/support/helpers";
import { createTestUser, createTestSwarm } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { POST } from "@/app/api/workspaces/[slug]/strut/embed-url/route";
import type { NextResponse } from "next/server";

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      encryptField: (_field: string, value: string) => ({ encrypted: value }),
      decryptField: (_field: string, _value: string) => "mock-swarm-api-key",
    }),
  },
}));

// No redis in the integration env; the hive-key lock just runs its body.
vi.mock("@/lib/locks/redis-lock", () => ({
  withLock: (_key: string, fn: () => Promise<unknown>) => fn(),
}));

// No redis in the integration env either — rate limiting is exercised as a
// unit concern in the dedicated 429 test below via a per-key call counter.
const rateLimitCounts = new Map<string, number>();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async (key: string, limit: number) => {
    const count = (rateLimitCounts.get(key) ?? 0) + 1;
    rateLimitCounts.set(key, count);
    if (count > limit) return { allowed: false, retryAfter: 60 };
    return { allowed: true };
  }),
}));

async function expectJson<T = unknown>(res: NextResponse | Response, status = 200): Promise<T> {
  const r = res as Response;
  expect(r.status).toBe(status);
  return r.json() as Promise<T>;
}

async function createOrg(githubLogin: string) {
  return db.sourceControlOrg.create({
    data: {
      githubLogin,
      githubInstallationId: Math.floor(Math.random() * 1_000_000) + 900000,
      type: "ORG",
      name: githubLogin,
    },
  });
}

async function createWorkspace(ownerId: string, orgId: string | null = null) {
  const slug = `strut-ws-test-${generateUniqueId()}`;
  return db.workspace.create({
    data: { name: slug, slug, ownerId, sourceControlOrgId: orgId },
  });
}

function mintCalls(): Array<[string, RequestInit]> {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(([url]) => url.endsWith("/mint-token"));
}

function makeParams(slug: string) {
  return Promise.resolve({ slug });
}

const createdOrgIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ token: "mock.jwt.token" }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  if (createdWorkspaceIds.length > 0) {
    await db.swarm.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
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
  vi.unstubAllGlobals();
});

async function seedUser(prefix: string) {
  const user = await createTestUser({
    email: `${prefix}-${generateUniqueId()}@example.com`,
    idempotent: false,
  });
  createdUserIds.push(user.id);
  return user;
}

async function seedMember(
  prefix: string,
  workspaceId: string,
  role: "ADMIN" | "PM" | "DEVELOPER" | "STAKEHOLDER" | "VIEWER",
) {
  const user = await seedUser(prefix);
  await db.workspaceMember.create({ data: { workspaceId, userId: user.id, role } });
  return user;
}

function postAs(slug: string, user: { id: string; email: string | null; name: string | null }) {
  const req = createAuthenticatedPostRequest(
    `/api/workspaces/${slug}/strut/embed-url`,
    {},
    { id: user.id, email: user.email!, name: user.name! },
  );
  return POST(req, { params: makeParams(slug) });
}

describe("POST /api/workspaces/[slug]/strut/embed-url", () => {
  it("returns 401 when signed out", async () => {
    const req = new Request("http://localhost/api/workspaces/x/strut/embed-url", { method: "POST" }) as any;
    const res = await POST(req, { params: makeParams("x") });
    expect((res as Response).status).toBe(401);
  });

  it("returns 404 for a slug that doesn't exist", async () => {
    const user = await seedUser("strut-ws-noslug");
    await expectJson(await postAs(`no-such-slug-${generateUniqueId()}`, user), 404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-member of an existing workspace", async () => {
    const owner = await seedUser("strut-ws-owner-nm");
    const ws = await createWorkspace(owner.id);
    createdWorkspaceIds.push(ws.id);
    const outsider = await seedUser("strut-ws-outsider");

    await expectJson(await postAs(ws.slug, outsider), 404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  for (const role of ["PM", "DEVELOPER", "STAKEHOLDER", "VIEWER"] as const) {
    it(`returns 403 for a ${role} member`, async () => {
      const owner = await seedUser(`strut-ws-owner-${role.toLowerCase()}`);
      const ws = await createWorkspace(owner.id);
      createdWorkspaceIds.push(ws.id);
      await createTestSwarm({
        workspaceId: ws.id,
        swarmUrl: `https://${role.toLowerCase()}.swarm.test/api`,
        swarmApiKey: "key",
      });
      const member = await seedMember(`strut-ws-${role.toLowerCase()}`, ws.id, role);

      const data = await expectJson<{ error: string }>(await postAs(ws.slug, member), 403);
      expect(data.error).toBe("Owner or Admin access required to open Strut");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it("returns 409 for an inactive swarm", async () => {
    const owner = await seedUser("strut-ws-owner-inactive");
    const ws = await createWorkspace(owner.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({
      workspaceId: ws.id,
      swarmUrl: "https://inactive.swarm.test/api",
      swarmApiKey: "key",
      status: "PENDING",
    });

    await expectJson(await postAs(ws.slug, owner), 409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 for a swarm row missing its url or key", async () => {
    const owner = await seedUser("strut-ws-owner-noconfig");
    const ws = await createWorkspace(owner.id);
    createdWorkspaceIds.push(ws.id);
    await db.swarm.create({
      data: {
        name: `noconfig-${generateUniqueId()}`,
        workspaceId: ws.id,
        status: "ACTIVE",
        swarmUrl: null,
        swarmApiKey: null,
      },
    });

    await expectJson(await postAs(ws.slug, owner), 503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 429 after 10 calls in a minute", async () => {
    const owner = await seedUser("strut-ws-owner-rl");
    const ws = await createWorkspace(owner.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({ workspaceId: ws.id, swarmUrl: "https://rl.swarm.test/api", swarmApiKey: "key" });

    for (let i = 0; i < 10; i++) {
      const res = await postAs(ws.slug, owner);
      expect((res as Response).status).toBe(200);
    }
    const res = await postAs(ws.slug, owner);
    expect((res as Response).status).toBe(429);
    expect((res as Response).headers.get("Retry-After")).toBeTruthy();
  });

  it("succeeds for OWNER: 1h TTL, x-api-token sent, expiresInSeconds 3600", async () => {
    const owner = await seedUser("strut-ws-owner-ok");
    const org = await createOrg(`strut-ws-org-${generateUniqueId()}`);
    createdOrgIds.push(org.id);
    const ws = await createWorkspace(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    const swarm = await createTestSwarm({
      workspaceId: ws.id,
      swarmUrl: "https://ownok.swarm.test/api",
      swarmApiKey: "key-ownok",
    });

    const data = await expectJson<{ url: string; workspaceSlug: string; expiresInSeconds: number }>(
      await postAs(ws.slug, owner),
      200,
    );
    expect(data.url).toBe("https://ownok.swarm.test:3355/lab/?key=mock.jwt.token");
    expect(data.workspaceSlug).toBe(ws.slug);
    expect(data.expiresInSeconds).toBe(3600);

    expect(mintCalls()).toHaveLength(1);
    const [mintUrl, init] = mintCalls()[0];
    expect(mintUrl).toBe("https://ownok.swarm.test:3355/mint-token");
    expect((init.headers as Record<string, string>)["x-api-token"]).toBe("mock-swarm-api-key");
    expect(JSON.parse(init.body as string).expires_in).toBe("1h");

    // ensure* steps ran with the workspace's OWN swarmId/workspaceId
    const updated = await db.swarm.findUniqueOrThrow({ where: { id: swarm.id } });
    expect(updated.strutHiveKeyId).not.toBeNull();
  });

  it("succeeds for ADMIN member", async () => {
    const owner = await seedUser("strut-ws-owner-admin-ok");
    const ws = await createWorkspace(owner.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({ workspaceId: ws.id, swarmUrl: "https://adminok.swarm.test/api", swarmApiKey: "key" });
    const admin = await seedMember("strut-ws-admin-ok", ws.id, "ADMIN");

    const data = await expectJson<{ expiresInSeconds: number }>(await postAs(ws.slug, admin), 200);
    expect(data.expiresInSeconds).toBe(3600);
  });

  it("creates the owner's WorkspaceMember row on first access; the delegation step doesn't fail on a missing membership", async () => {
    const owner = await seedUser("strut-ws-owner-nomember");
    const ws = await createWorkspace(owner.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({ workspaceId: ws.id, swarmUrl: "https://nomember.swarm.test/api", swarmApiKey: "key" });

    expect(
      await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.id, userId: owner.id } } }),
    ).toBeNull();

    await expectJson(await postAs(ws.slug, owner), 200);

    const member = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: ws.id, userId: owner.id } },
    });
    expect(member).not.toBeNull();
    expect(member?.role).toBe("OWNER");
  });

  it("still returns a URL and skips the delegation push for a workspace with no sourceControlOrgId", async () => {
    const owner = await seedUser("strut-ws-owner-noorg");
    const ws = await createWorkspace(owner.id, null);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({ workspaceId: ws.id, swarmUrl: "https://noorg.swarm.test/api", swarmApiKey: "key" });

    const data = await expectJson<{ url: string }>(await postAs(ws.slug, owner), 200);
    expect(data.url).toBe("https://noorg.swarm.test:3355/lab/?key=mock.jwt.token");
    // Hive-key push is also a no-op (no org to scope the key to) — no PUT /secrets calls.
    expect((fetchMock.mock.calls as Array<[string]>).filter(([url]) => url.includes("/lab/secrets/"))).toHaveLength(0);
  });
});
