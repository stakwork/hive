/**
 * Unit tests for `services/strut-peers.ts` — the daily pass that keeps each
 * org strut's peer records (a `lab:peer` token minted on every other
 * workspace swarm in the org, by slug) and its users' delegations on those
 * swarms' struts, through the ORG strut's gateway.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockOrgFindMany, mockWorkspaceFindMany, mockMemberFindMany, mockList, mockPush } = vi.hoisted(() => ({
  mockOrgFindMany: vi.fn(),
  mockWorkspaceFindMany: vi.fn(),
  mockMemberFindMany: vi.fn(),
  mockList: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    sourceControlOrg: { findMany: mockOrgFindMany },
    workspace: { findMany: mockWorkspaceFindMany },
    workspaceMember: { findMany: mockMemberFindMany },
  },
}));
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      decryptField: (_field: string, value: string) => {
        if (!value.startsWith("enc:")) throw new Error("bad ciphertext");
        return value.slice(4);
      },
    }),
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/bifrost/reconciler", () => ({
  buildBifrostName: (userId: string, login: string | null) => (login ? `${login}-${userId}` : userId),
}));
vi.mock("@/services/bifrost/strut-delegation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/bifrost/strut-delegation")>()),
  listStrutDelegations: mockList,
  pushStrutDelegation: mockPush,
}));

import { runStrutPeersReconcile } from "@/services/strut-peers";
import { StrutDelegationsUnsupportedError } from "@/services/bifrost/strut-delegation";

const swarm = (name: string, key = `enc:${name}-key`) => ({
  id: `swarm-${name}`,
  swarmUrl: `https://${name}.sphinx.chat/api`,
  swarmApiKey: key,
});

/** The org strut: the org's default workspace's swarm. */
const ORG = {
  id: "org-1",
  githubLogin: "acme",
  defaultWorkspace: { id: "ws-org", slug: "hive", name: "Hive", swarm: swarm("org") },
};
const WORKSPACES = [
  // The org strut's own workspace: never its own peer.
  { id: "ws-org", slug: "hive", name: "Hive", swarm: swarm("org") },
  { id: "ws-b", slug: "acme-web", name: "Acme web", swarm: swarm("b") },
  { id: "ws-c", slug: "acme-api", name: "Acme API", swarm: swarm("c") },
];
const MEMBERS = [
  { userId: "u1", user: { githubAuth: { githubUsername: "alice" } } },
  { userId: "u2", user: { githubAuth: null } },
];
const ORG_LAB = "https://org.sphinx.chat:3355/lab";
const lab = (name: string) => ({ labBase: `https://${name}.sphinx.chat:3355/lab`, swarmApiKey: `${name}-key` });

const NOW = new Date("2026-10-10T03:50:00.000Z");
const DAY_MS = 24 * 3600 * 1000;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY_MS).toISOString();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const mockFetch = vi.fn();

/** A mint answers with a `lab:peer` token named after the swarm; the org strut takes every PUT. */
function routeFetch(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  mockFetch.mockImplementation(async (url: string) => {
    for (const [prefix, answer] of Object.entries(overrides)) if (url.startsWith(prefix)) return answer();
    const mint = url.match(/^https:\/\/(\w+)\.sphinx\.chat:3355\/mint-token$/);
    if (mint) return json(200, { token: `peer-tok-${mint[1]}`, expires_in: "60d", scope: "lab:peer" });
    if (url.includes(".sphinx.chat:3355/lab/peers/")) return json(200, { ok: true });
    throw new Error(`unexpected fetch ${url}`);
  });
}

const calls = (pred: (url: string) => boolean) => mockFetch.mock.calls.filter(([url]) => pred(url));

const ORIGINAL_ENV = { BIFROST_ENABLED: process.env.BIFROST_ENABLED, BIFROST_ENABLED_AGENTS: process.env.BIFROST_ENABLED_AGENTS };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  process.env.BIFROST_ENABLED = "hive";
  delete process.env.BIFROST_ENABLED_AGENTS;
  mockOrgFindMany.mockResolvedValue([ORG]);
  mockWorkspaceFindMany.mockResolvedValue(WORKSPACES);
  mockMemberFindMany.mockResolvedValue(MEMBERS);
  mockList.mockResolvedValue([]);
  mockPush.mockResolvedValue({ actor: "x", exp: inDays(60), delegationId: "d-1" });
  routeFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("runStrutPeersReconcile — peer records", () => {
  it("puts a lab:peer token from every other active swarm on the org strut, named by slug", async () => {
    const out = await runStrutPeersReconcile({ now: NOW });
    expect(out).toMatchObject({ success: true, orgsProcessed: 1, peersPushed: 2, peersUnsupported: 0, errors: [] });

    // The org strut is the org's DEFAULT workspace's active swarm.
    expect(mockOrgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { defaultWorkspace: { is: { deleted: false, swarm: { is: { status: "ACTIVE" } } } } },
      }),
    );
    expect(mockWorkspaceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sourceControlOrgId: "org-1", deleted: false, swarm: { is: { status: "ACTIVE" } } } }),
    );

    // Minted ON the peer's swarm, with ITS key, as lab:peer — no `sub`.
    const [mint] = calls((u) => u === "https://b.sphinx.chat:3355/mint-token");
    expect(mint[1].method).toBe("POST");
    expect(mint[1].headers["x-api-token"]).toBe("b-key");
    expect(JSON.parse(mint[1].body)).toEqual({ scope: "lab:peer" });

    // Put on the ORG strut with the org's key, at the slug, pointing at the peer's lab.
    const [put] = calls((u) => u === `${ORG_LAB}/peers/acme-web`);
    expect(put[1].method).toBe("PUT");
    expect(put[1].headers["x-api-token"]).toBe("org-key");
    expect(put[1].headers.Authorization).toBe("Bearer org-key");
    expect(JSON.parse(put[1].body)).toEqual({ baseUrl: "https://b.sphinx.chat:3355/lab", token: "peer-tok-b", label: "Acme web" });

    // Never the org strut's own swarm.
    expect(calls((u) => u.startsWith("https://org.sphinx.chat:3355/mint-token"))).toHaveLength(0);
    expect(calls((u) => u === `${ORG_LAB}/peers/hive`)).toHaveLength(0);
  });

  it("an mcp that cannot mint a lab:peer token gets no record — never an api token in its place", async () => {
    // An mcp older than stakgraph#1754 ignores `scope` and mints an `api` token.
    routeFetch({ "https://b.sphinx.chat:3355/mint-token": () => json(200, { token: "admin-jwt", expires_in: "1h" }) });
    const out = await runStrutPeersReconcile({ now: NOW });
    expect(out).toMatchObject({ success: true, peersPushed: 1, peersUnsupported: 1 });
    expect(calls((u) => u === `${ORG_LAB}/peers/acme-web`)).toHaveLength(0);
    expect(JSON.stringify(mockFetch.mock.calls)).not.toContain("admin-jwt");
  });

  it("a swarm that fails is an error for that peer and the rest go on; an org strut without /peers is unsupported", async () => {
    routeFetch({
      "https://b.sphinx.chat:3355/mint-token": () => {
        throw new Error("ECONNREFUSED");
      },
      [`${ORG_LAB}/peers/acme-api`]: () => json(404, { error: "Not Found" }),
    });
    const out = await runStrutPeersReconcile({ now: NOW });
    expect(out).toMatchObject({ success: false, peersPushed: 0, peersUnsupported: 1 });
    expect(out.errors).toEqual([{ org: "acme", peer: "acme-web", error: "ECONNREFUSED" }]);
  });

  it("a key that does not decrypt is an error for its peer, or for its org — and the next org still runs", async () => {
    mockWorkspaceFindMany.mockResolvedValueOnce([
      ...WORKSPACES,
      { id: "ws-x", slug: "broken", name: "Broken", swarm: swarm("x", "garbage") },
    ]);
    mockOrgFindMany.mockResolvedValue([
      ORG,
      { ...ORG, id: "org-2", githubLogin: "beta", defaultWorkspace: { ...ORG.defaultWorkspace, swarm: swarm("org2", "garbage") } },
    ]);
    const out = await runStrutPeersReconcile({ now: NOW });
    expect(out.peersPushed).toBe(2);
    expect(out.errors).toEqual([
      { org: "acme", peer: "broken", error: expect.stringContaining("decrypt failed") },
      { org: "beta", error: "bad ciphertext" },
    ]);
  });

  it("an org with no other swarm has nothing to push; ?org scopes the pass", async () => {
    mockWorkspaceFindMany.mockResolvedValue([WORKSPACES[0]]);
    const out = await runStrutPeersReconcile({ now: NOW, org: "acme" });
    expect(out).toMatchObject({ success: true, orgsProcessed: 1, peersPushed: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockOrgFindMany.mock.calls[0][0].where).toMatchObject({ githubLogin: "acme" });
  });
});

describe("runStrutPeersReconcile — the org strut's users' delegations on each peer", () => {
  it("are pushed through the ORG strut's gateway when missing or due, and never recorded", async () => {
    mockList.mockImplementation(async (target: { labBase: string }) =>
      target.labBase === lab("c").labBase
        ? [
            { actor: "alice-u1", exp: inDays(50), delegationId: "fresh" },
            { actor: "u2", exp: inDays(10), delegationId: "due" },
          ]
        : [],
    );
    const out = await runStrutPeersReconcile({ now: NOW });
    expect(out).toMatchObject({ success: true, delegationsPushed: 3 });

    // The users: org-workspace members with their own delegation on record.
    expect(mockMemberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "ws-org", leftAt: null, strutDelegationId: { not: null } } }),
    );
    // Listed on each PEER's lab with the peer's key...
    expect(mockList).toHaveBeenCalledWith(lab("b"));
    expect(mockList).toHaveBeenCalledWith(lab("c"));
    // ...minted for the ORG workspace through the ORG strut's gateway, PUT on the peer.
    const pushed = mockPush.mock.calls.map(([o]) => `${o.userId}@${o.target.labBase}`).sort();
    expect(pushed).toEqual([`u1@${lab("b").labBase}`, `u2@${lab("b").labBase}`, `u2@${lab("c").labBase}`]);
    expect(mockPush).toHaveBeenCalledWith({
      workspaceId: "ws-org",
      userId: "u1",
      swarmUrl: "https://org.sphinx.chat/api",
      target: lab("b"),
      record: false,
    });
  });

  it("follows the ORG workspace's gate, not the peer's: closed → none listed or pushed, peer records still", async () => {
    process.env.BIFROST_ENABLED = "acme-web,acme-api";
    const out = await runStrutPeersReconcile({ now: NOW });
    expect(out).toMatchObject({ success: true, peersPushed: 2, delegationsPushed: 0 });
    expect(mockMemberFindMany).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("a peer lab without delegation routes is skipped quietly; a failed push is an error with its actor", async () => {
    mockList.mockImplementation(async (target: { labBase: string }) => {
      if (target.labBase === lab("b").labBase) throw new StrutDelegationsUnsupportedError(target.labBase);
      return [];
    });
    mockPush.mockImplementation(async (o: { userId: string }) => {
      if (o.userId === "u1") throw new Error("PUT returned 400");
      return { actor: "u2", exp: inDays(60), delegationId: "d-2" };
    });
    const out = await runStrutPeersReconcile({ now: NOW });
    expect(out).toMatchObject({ success: false, delegationsPushed: 1 });
    expect(out.errors).toEqual([{ org: "acme", peer: "acme-api", actor: "alice-u1", error: "PUT returned 400" }]);
  });
});
