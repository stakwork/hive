/**
 * Unit tests for `services/strut-peers.ts` — before a job turn, the org
 * strut's peer records (a `lab:peer` token minted on every other workspace
 * swarm in the org, by slug) and the user's delegation on each of those
 * struts, through the ORG strut's gateway.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFindMany, mockList, mockPush } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockList: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { workspace: { findMany: mockFindMany } } }));
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
vi.mock("@/services/bifrost/strut-delegation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/bifrost/strut-delegation")>()),
  listStrutDelegations: mockList,
  pushStrutDelegation: mockPush,
}));

import { ensureJobPeers } from "@/services/strut-peers";
import { StrutDelegationsUnsupportedError } from "@/services/bifrost/strut-delegation";

const ORG = {
  swarmId: "swarm-org",
  workspaceId: "ws-org",
  workspaceSlug: "hive",
  orgId: "org-1",
  swarmUrl: "https://org.sphinx.chat/api",
  mcpBase: "https://org.sphinx.chat:3355",
  labBase: "https://org.sphinx.chat:3355/lab",
  swarmApiKey: "org-key",
  actor: "alice-u1",
};

const WORKSPACES = [
  // The org strut's own workspace: never its own peer.
  { slug: "hive", name: "Hive", swarm: { id: "swarm-org", swarmUrl: "https://org.sphinx.chat/api", swarmApiKey: "enc:org-key" } },
  { slug: "acme-web", name: "Acme web", swarm: { id: "swarm-b", swarmUrl: "https://b.sphinx.chat/api", swarmApiKey: "enc:b-key" } },
  { slug: "acme-api", name: "Acme API", swarm: { id: "swarm-c", swarmUrl: "https://c.sphinx.chat/api", swarmApiKey: "enc:c-key" } },
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const mockFetch = vi.fn();
const DAY_MS = 24 * 3600 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

/** A mint answers with a `lab:peer` token named after the swarm; the org strut takes every PUT. */
function routeFetch(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  mockFetch.mockImplementation(async (url: string) => {
    for (const [prefix, answer] of Object.entries(overrides)) if (url.startsWith(prefix)) return answer();
    const mint = url.match(/^https:\/\/(\w+)\.sphinx\.chat:3355\/mint-token$/);
    if (mint) return json(200, { token: `peer-tok-${mint[1]}`, expires_in: "60d", scope: "lab:peer" });
    if (url.startsWith(`${ORG.labBase}/peers/`)) return json(200, { ok: true });
    throw new Error(`unexpected fetch ${url}`);
  });
}

const ORIGINAL_ENV = { BIFROST_ENABLED: process.env.BIFROST_ENABLED, BIFROST_ENABLED_AGENTS: process.env.BIFROST_ENABLED_AGENTS };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  process.env.BIFROST_ENABLED = "hive";
  delete process.env.BIFROST_ENABLED_AGENTS;
  mockFindMany.mockResolvedValue(WORKSPACES);
  mockList.mockResolvedValue([]);
  mockPush.mockResolvedValue({ actor: ORG.actor, exp: inDays(60), delegationId: "d-1" });
  routeFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("ensureJobPeers — peer records", () => {
  it("puts a lab:peer token from every other active workspace swarm on the org strut, named by slug", async () => {
    const out = await ensureJobPeers(ORG, "u1");
    expect(out.peers).toEqual({ "acme-web": "pushed", "acme-api": "pushed" });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { sourceControlOrgId: "org-1", deleted: false, swarm: { is: { status: "ACTIVE" } } },
      select: { slug: true, name: true, swarm: { select: { id: true, swarmUrl: true, swarmApiKey: true } } },
    });

    // Minted ON the peer's swarm, with ITS key, as lab:peer — no `sub`.
    const mint = mockFetch.mock.calls.find(([url]) => url === "https://b.sphinx.chat:3355/mint-token")!;
    expect(mint[1].method).toBe("POST");
    expect(mint[1].headers["x-api-token"]).toBe("b-key");
    expect(JSON.parse(mint[1].body)).toEqual({ scope: "lab:peer" });

    // Put on the ORG strut with the org's key, at the slug, pointing at the peer's lab.
    const put = mockFetch.mock.calls.find(([url]) => url === `${ORG.labBase}/peers/acme-web`)!;
    expect(put[1].method).toBe("PUT");
    expect(put[1].headers["x-api-token"]).toBe("org-key");
    expect(put[1].headers.Authorization).toBe("Bearer org-key");
    expect(JSON.parse(put[1].body)).toEqual({
      baseUrl: "https://b.sphinx.chat:3355/lab",
      token: "peer-tok-b",
      label: "Acme web",
    });

    // Never the org strut's own swarm.
    expect(mockFetch.mock.calls.some(([url]) => url.startsWith("https://org.sphinx.chat:3355/mint-token"))).toBe(false);
    expect(mockFetch.mock.calls.some(([url]) => url === `${ORG.labBase}/peers/hive`)).toBe(false);
  });

  it("an mcp that cannot mint a lab:peer token gets no record — never an api token in its place", async () => {
    routeFetch({
      // An mcp older than stakgraph#1754 ignores `scope` and mints an `api` token.
      "https://b.sphinx.chat:3355/mint-token": () => json(200, { token: "admin-jwt", expires_in: "1h" }),
    });
    const out = await ensureJobPeers(ORG, "u1");
    expect(out.peers).toEqual({ "acme-web": "unsupported", "acme-api": "pushed" });
    expect(mockFetch.mock.calls.some(([url]) => url === `${ORG.labBase}/peers/acme-web`)).toBe(false);
    expect(JSON.stringify(mockFetch.mock.calls)).not.toContain("admin-jwt");
  });

  it("a swarm that fails is skipped and the rest go on; an org strut without /peers is unsupported", async () => {
    routeFetch({
      "https://b.sphinx.chat:3355/mint-token": () => {
        throw new Error("ECONNREFUSED");
      },
      [`${ORG.labBase}/peers/acme-api`]: () => json(404, { error: "Not Found" }),
    });
    const out = await ensureJobPeers(ORG, "u1");
    expect(out.peers).toEqual({ "acme-web": "failed", "acme-api": "unsupported" });
  });

  it("skips a swarm whose key does not decrypt, and does nothing without an org", async () => {
    mockFindMany.mockResolvedValue([
      ...WORKSPACES,
      { slug: "broken", name: "Broken", swarm: { id: "swarm-x", swarmUrl: "https://x.sphinx.chat/api", swarmApiKey: "garbage" } },
    ]);
    expect(Object.keys((await ensureJobPeers(ORG, "u1")).peers).sort()).toEqual(["acme-api", "acme-web"]);

    vi.clearAllMocks();
    expect(await ensureJobPeers({ ...ORG, orgId: null }, "u1")).toEqual({ peers: {}, delegations: {} });
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("never throws, even when the org's workspaces cannot be read", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    await expect(ensureJobPeers(ORG, "u1")).resolves.toEqual({ peers: {}, delegations: {} });
  });
});

describe("ensureJobPeers — the user's delegation on each peer", () => {
  it("is pushed through the ORG strut's gateway when the peer has none, and not recorded", async () => {
    mockList.mockImplementation(async (lab: { labBase: string }) =>
      lab.labBase === "https://c.sphinx.chat:3355/lab" ? [{ actor: ORG.actor, exp: inDays(50), delegationId: "d-c" }] : [],
    );
    const out = await ensureJobPeers(ORG, "u1");
    expect(out.delegations).toEqual({ "acme-web": "pushed", "acme-api": "fresh" });

    // Listed on the PEER's lab with the peer's key...
    expect(mockList).toHaveBeenCalledWith({ labBase: "https://b.sphinx.chat:3355/lab", swarmApiKey: "b-key" });
    // ...and minted for the ORG workspace (its virtual key, its gateway), PUT on the peer.
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      workspaceId: "ws-org",
      userId: "u1",
      swarmUrl: "https://org.sphinx.chat/api",
      target: { labBase: "https://b.sphinx.chat:3355/lab", swarmApiKey: "b-key" },
      record: false,
    });
  });

  it("another person's delegation does not count; one past half its life is renewed", async () => {
    mockList.mockImplementation(async (lab: { labBase: string }) =>
      lab.labBase === "https://b.sphinx.chat:3355/lab"
        ? [{ actor: "bob-u2", exp: inDays(50), delegationId: "d-bob" }]
        : [{ actor: ORG.actor, exp: inDays(10), delegationId: "d-old" }],
    );
    const out = await ensureJobPeers(ORG, "u1");
    expect(out.delegations).toEqual({ "acme-web": "pushed", "acme-api": "pushed" });
  });

  it("follows the ORG workspace's gate, not the peer's: closed → nothing pushed, peers still recorded", async () => {
    process.env.BIFROST_ENABLED = "acme-web,acme-api";
    const out = await ensureJobPeers(ORG, "u1");
    expect(out.delegations).toEqual({ "acme-web": "skipped-gate", "acme-api": "skipped-gate" });
    expect(out.peers).toEqual({ "acme-web": "pushed", "acme-api": "pushed" });
    expect(mockList).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("an older lab without delegation routes is unsupported; a failed push is failed — never a throw", async () => {
    mockList.mockImplementation(async (lab: { labBase: string }) => {
      if (lab.labBase === "https://b.sphinx.chat:3355/lab") throw new StrutDelegationsUnsupportedError(lab.labBase);
      return [];
    });
    mockPush.mockRejectedValue(new Error("no WorkspaceMember row"));
    const out = await ensureJobPeers(ORG, "u1");
    expect(out.delegations).toEqual({ "acme-web": "unsupported", "acme-api": "failed" });
  });
});
