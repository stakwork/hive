/**
 * Integration tests for POST /api/orgs/[githubLogin]/strut/embed-url
 *
 * The mcp `/mint-token` call is mocked — these tests verify the route
 * resolves the right swarm, mints with the swarm API key server-side, and
 * hands the client a `/lab/?key=<jwt>` URL (never the raw key).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createAuthenticatedPostRequest, generateUniqueId } from "@/__tests__/support/helpers";
import { createTestUser, createTestSwarm } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { POST } from "@/app/api/orgs/[githubLogin]/strut/embed-url/route";
import type { NextResponse } from "next/server";
import { hashApiKey } from "@/lib/api-keys";

// Both encryptField (createTestSwarm factory) and decryptField (the route)
// are mocked so no real KEY env vars are needed.
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

async function expectJson<T = unknown>(res: NextResponse | Response, status = 200): Promise<T> {
  const r = res as Response;
  expect(r.status).toBe(status);
  return r.json() as Promise<T>;
}

let installationIdCounter = 770000;

async function createOrg(githubLogin: string) {
  return db.sourceControlOrg.create({
    data: {
      githubLogin,
      githubInstallationId: installationIdCounter++,
      type: "ORG",
      name: githubLogin,
    },
  });
}

async function createWorkspaceInOrg(ownerId: string, orgId: string, suffix = "") {
  const slug = `strut-test-ws-${generateUniqueId()}${suffix}`;
  return db.workspace.create({
    data: { name: slug, slug, ownerId, sourceControlOrgId: orgId },
  });
}

function mintCalls(): Array<[string, RequestInit]> {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(([url]) => url.endsWith("/mint-token"));
}

function secretPuts(): Array<[string, RequestInit]> {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(([url]) => url.includes("/lab/secrets/"));
}

function makeParams(githubLogin: string) {
  return Promise.resolve({ githubLogin });
}

const createdOrgIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ token: "mock.jwt.token", expires_in: "8h" }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  if (createdWorkspaceIds.length > 0) {
    await db.swarm.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
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
  vi.unstubAllGlobals();
});

async function seedOwner(prefix: string) {
  const owner = await createTestUser({
    email: `${prefix}-${generateUniqueId()}@example.com`,
    idempotent: false,
  });
  createdUserIds.push(owner.id);
  return owner;
}

function postAs(githubLogin: string, user: { id: string; email: string | null; name: string | null }) {
  const req = createAuthenticatedPostRequest(
    `/api/orgs/${githubLogin}/strut/embed-url`,
    {},
    { id: user.id, email: user.email!, name: user.name! },
  );
  return POST(req, { params: makeParams(githubLogin) });
}

describe("POST /api/orgs/[githubLogin]/strut/embed-url", () => {
  it("mints against the default workspace's mcp and returns its /lab/?key= URL", async () => {
    const githubLogin = `strut-org-default-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedOwner("strut-owner");

    // Created first — what a plain first-reachable lookup would return.
    const fallbackWs = await createWorkspaceInOrg(owner.id, org.id, "-fallback");
    createdWorkspaceIds.push(fallbackWs.id);
    await createTestSwarm({
      workspaceId: fallbackWs.id,
      swarmUrl: "https://fallback.swarm.test/api",
      swarmApiKey: "key-fallback",
    });

    const defaultWs = await createWorkspaceInOrg(owner.id, org.id, "-default");
    createdWorkspaceIds.push(defaultWs.id);
    await createTestSwarm({
      workspaceId: defaultWs.id,
      swarmUrl: "https://default.swarm.test/api",
      swarmApiKey: "key-default",
    });
    await db.sourceControlOrg.update({
      where: { id: org.id },
      data: { defaultWorkspaceId: defaultWs.id },
    });

    const res = await postAs(githubLogin, owner);
    const data = await expectJson<{ url: string; workspaceSlug: string }>(res, 200);

    expect(data.url).toBe("https://default.swarm.test:3355/lab/?key=mock.jwt.token");
    expect(data.workspaceSlug).toBe(defaultWs.slug);
    // The raw swarm key stays server-side: header on the mint, never in the URL.
    expect(data.url).not.toContain("mock-swarm-api-key");

    expect(mintCalls()).toHaveLength(1);
    const [mintUrl, init] = mintCalls()[0];
    expect(mintUrl).toBe("https://default.swarm.test:3355/mint-token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-token"]).toBe("mock-swarm-api-key");
    // `sub` is the user's actor string — `buildBifrostName(userId, login)`,
    // the macaroon user_id — so strut bills the embed's spend to them. The
    // fixture user has no GitHub login, so it is the bare id.
    expect(JSON.parse(init.body as string)).toEqual({ expires_in: "8h", sub: owner.id });
  });

  it("puts {login}-{userId} in `sub` for a user with a GitHub login", async () => {
    const githubLogin = `strut-org-sub-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedOwner("strut-owner-sub");
    await db.gitHubAuth.create({
      data: {
        userId: owner.id,
        githubUserId: `gh-${generateUniqueId()}`,
        githubUsername: "octo-owner",
      },
    });

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({
      workspaceId: ws.id,
      swarmUrl: "https://sub.swarm.test/api",
      swarmApiKey: "key-sub",
    });

    await expectJson(await postAs(githubLogin, owner), 200);
    const [, init] = mintCalls()[0];
    expect(JSON.parse(init.body as string).sub).toBe(`octo-owner-${owner.id}`);
    // BIFROST_ENABLED is unset here, so no delegation push follows the mint.
    expect(
      (fetchMock.mock.calls as Array<[string]>).filter(([url]) => url.includes("/llm/delegations")),
    ).toHaveLength(0);
  });

  it("falls back to the first reachable workspace when no default is set", async () => {
    const githubLogin = `strut-org-nodefault-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedOwner("strut-owner-nd");

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({
      workspaceId: ws.id,
      swarmUrl: "https://only.swarm.test/api",
      swarmApiKey: "key-only",
    });

    const data = await expectJson<{ url: string }>(await postAs(githubLogin, owner), 200);
    expect(data.url).toBe("https://only.swarm.test:3355/lab/?key=mock.jwt.token");
  });

  it("does not mint for a user with no workspace access in the org", async () => {
    const githubLogin = `strut-org-noaccess-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedOwner("strut-owner-na");
    const outsider = await seedOwner("strut-outsider");

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({
      workspaceId: ws.id,
      swarmUrl: "https://private.swarm.test/api",
      swarmApiKey: "key-private",
    });

    await expectJson(await postAs(githubLogin, outsider), 404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no workspace in the org has a swarm", async () => {
    const githubLogin = `strut-org-noswarm-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedOwner("strut-owner-ns");

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);

    await expectJson(await postAs(githubLogin, owner), 404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when mcp refuses the mint", async () => {
    const githubLogin = `strut-org-mintfail-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const owner = await seedOwner("strut-owner-mf");

    const ws = await createWorkspaceInOrg(owner.id, org.id);
    createdWorkspaceIds.push(ws.id);
    await createTestSwarm({
      workspaceId: ws.id,
      swarmUrl: "https://mintfail.swarm.test/api",
      swarmApiKey: "key-mintfail",
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
      text: async () => '{"error":"Unauthorized"}',
    });

    const data = await expectJson<{ error: string }>(await postAs(githubLogin, owner), 502);
    expect(data.error).toContain("401");
  });

  describe("HIVE_API_KEY on the strut", () => {
    async function seedEmbeddable(prefix: string) {
      const githubLogin = `${prefix}-${generateUniqueId()}`;
      const org = await createOrg(githubLogin);
      createdOrgIds.push(org.id);
      const owner = await seedOwner(prefix);
      const ws = await createWorkspaceInOrg(owner.id, org.id);
      createdWorkspaceIds.push(ws.id);
      const swarm = await createTestSwarm({
        workspaceId: ws.id,
        swarmUrl: "https://hivekey.swarm.test/api",
        swarmApiKey: "key-hivekey",
      });
      return { githubLogin, org, owner, swarm };
    }

    it("mints an org key on first embed and pushes it with HIVE_URL to the deployment store", async () => {
      const { githubLogin, org, owner, swarm } = await seedEmbeddable("strut-hivekey");

      await expectJson(await postAs(githubLogin, owner), 200);

      const puts = secretPuts();
      expect(puts.map(([url]) => url)).toEqual([
        "https://hivekey.swarm.test:3355/lab/secrets/HIVE_API_KEY",
        "https://hivekey.swarm.test:3355/lab/secrets/HIVE_URL",
      ]);
      for (const [, init] of puts) {
        expect(init.method).toBe("PUT");
        const headers = init.headers as Record<string, string>;
        expect(headers["x-api-token"]).toBe("mock-swarm-api-key");
        expect(headers.Authorization).toBe("Bearer mock-swarm-api-key");
      }
      const rawKey = JSON.parse(puts[0][1].body as string).value as string;
      expect(rawKey).toMatch(/^hiveorg_/);

      const updated = await db.swarm.findUniqueOrThrow({ where: { id: swarm.id } });
      const key = await db.orgApiKey.findUniqueOrThrow({ where: { id: updated.strutHiveKeyId! } });
      expect(key.sourceControlOrgId).toBe(org.id);
      expect(key.revokedAt).toBeNull();
      expect(key.keyHash).toBe(hashApiKey(rawKey));
    });

    it("sends nothing on a later embed while the key on record is live", async () => {
      const { githubLogin, owner } = await seedEmbeddable("strut-hivekey-again");

      await expectJson(await postAs(githubLogin, owner), 200);
      fetchMock.mockClear();
      await expectJson(await postAs(githubLogin, owner), 200);

      expect(secretPuts()).toHaveLength(0);
      expect(await db.orgApiKey.count({ where: { createdById: owner.id } })).toBe(1);
    });

    it("replaces a revoked key and revokes nothing live", async () => {
      const { githubLogin, owner, swarm } = await seedEmbeddable("strut-hivekey-revoked");

      await expectJson(await postAs(githubLogin, owner), 200);
      const first = (await db.swarm.findUniqueOrThrow({ where: { id: swarm.id } })).strutHiveKeyId!;
      await db.orgApiKey.update({ where: { id: first }, data: { revokedAt: new Date() } });

      fetchMock.mockClear();
      await expectJson(await postAs(githubLogin, owner), 200);

      expect(secretPuts()).toHaveLength(2);
      const second = (await db.swarm.findUniqueOrThrow({ where: { id: swarm.id } })).strutHiveKeyId!;
      expect(second).not.toBe(first);
      expect((await db.orgApiKey.findUniqueOrThrow({ where: { id: second } })).revokedAt).toBeNull();
    });

    it("revokes the fresh key and keeps no pointer when strut refuses the push; the embed still succeeds", async () => {
      const { githubLogin, owner, swarm } = await seedEmbeddable("strut-hivekey-fail");

      fetchMock.mockImplementation(async (url: string) =>
        url.includes("/lab/secrets/")
          ? { ok: false, status: 500, json: async () => ({}), text: async () => "boom" }
          : { ok: true, status: 200, json: async () => ({ token: "mock.jwt.token" }), text: async () => "" },
      );

      await expectJson(await postAs(githubLogin, owner), 200);

      expect((await db.swarm.findUniqueOrThrow({ where: { id: swarm.id } })).strutHiveKeyId).toBeNull();
      const keys = await db.orgApiKey.findMany({ where: { createdById: owner.id } });
      expect(keys).toHaveLength(1);
      expect(keys[0].revokedAt).not.toBeNull();
    });
  });
});
