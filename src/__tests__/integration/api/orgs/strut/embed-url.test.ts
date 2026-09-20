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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [mintUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(mintUrl).toBe("https://default.swarm.test:3355/mint-token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-token"]).toBe("mock-swarm-api-key");
    expect(JSON.parse(init.body as string)).toEqual({ expires_in: "8h" });
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
});
