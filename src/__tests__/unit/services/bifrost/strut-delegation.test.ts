/**
 * Unit tests for the strut standing delegation push
 * (`services/bifrost/strut-delegation.ts`).
 *
 * Coverage:
 *   - Gates: BIFROST_ENABLED / BIFROST_ENABLED_AGENTS / missing auth / the
 *     public viewer → skipped, strut never called.
 *   - `GET /llm/delegations` carries BOTH credentials (mcp's x-api-token and
 *     strut's bearer), against `{mcp}/lab`.
 *   - A delegation with more than half its life left → `fresh`, no mint,
 *     desired-state columns brought in step.
 *   - Missing or past half-life → trust, catalog, VK, mint (agentName
 *     strut-agent, maxSteps 0, ceiling, 60d) then PUT { macaroon, apiKey,
 *     baseUrl = gateway ROOT } at the actor URL; columns recorded.
 *   - 404 on the list → `unsupported`; any failure → `failed`, never a throw.
 *   - The ceiling env override, and the actor string.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockEnsureBifrostTrust,
  mockEnsureBifrostAgentCatalog,
  mockReconcileBifrostVK,
  mockMintInvocationMacaroon,
  mockUserFindUnique,
  mockMemberUpdateMany,
} = vi.hoisted(() => ({
  mockEnsureBifrostTrust: vi.fn(),
  mockEnsureBifrostAgentCatalog: vi.fn(),
  mockReconcileBifrostVK: vi.fn(),
  mockMintInvocationMacaroon: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockMemberUpdateMany: vi.fn(),
}));

vi.mock("@/services/bifrost/trust-reconciler", () => ({
  ensureBifrostTrust: mockEnsureBifrostTrust,
}));
vi.mock("@/services/bifrost/agent-catalog-reconciler", () => ({
  ensureBifrostAgentCatalog: mockEnsureBifrostAgentCatalog,
}));
vi.mock("@/services/bifrost/reconciler", () => ({
  reconcileBifrostVK: mockReconcileBifrostVK,
  buildBifrostName: (userId: string, login: string | null) => (login ? `${login}-${userId}` : userId),
}));
vi.mock("@/services/bifrost/macaroon-issuer", () => ({
  mintInvocationMacaroon: mockMintInvocationMacaroon,
}));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: mockUserFindUnique },
    workspaceMember: { updateMany: mockMemberUpdateMany },
  },
}));

import {
  ensureStrutDelegation,
  isPastHalfLife,
  isWithinRenewWindow,
  resolveStrutActor,
  strutDelegationMaxCostUsd,
  strutLabBaseUrl,
} from "@/services/bifrost/strut-delegation";
import { STRUT_DELEGATION_DEFAULT_MAX_COST_USD, STRUT_DELEGATION_TTL_SECONDS } from "@/services/bifrost/constants";

const auth = { workspaceId: "ws-1", workspaceSlug: "acme", userId: "u_alice" };
const swarm = { swarmUrl: "https://swarm1.sphinx.chat/api", swarmApiKey: "swarm-key" };
const ACTOR = "alice-u_alice";
const NOW = new Date("2026-09-22T12:00:00.000Z");
const DAY_MS = 24 * 3600 * 1000;

const mockFetch = vi.fn();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function expAfterDays(days: number): string {
  return new Date(NOW.getTime() + days * DAY_MS).toISOString();
}

const ORIGINAL_ENV = {
  BIFROST_ENABLED: process.env.BIFROST_ENABLED,
  BIFROST_ENABLED_AGENTS: process.env.BIFROST_ENABLED_AGENTS,
  STRUT_DELEGATION_MAX_COST_USD: process.env.STRUT_DELEGATION_MAX_COST_USD,
};

function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("ensureStrutDelegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    process.env.BIFROST_ENABLED = "true";
    delete process.env.BIFROST_ENABLED_AGENTS;
    delete process.env.STRUT_DELEGATION_MAX_COST_USD;

    mockUserFindUnique.mockResolvedValue({ githubAuth: { githubUsername: "alice" } });
    mockMemberUpdateMany.mockResolvedValue({ count: 1 });
    mockEnsureBifrostTrust.mockResolvedValue({ status: "cached" });
    mockEnsureBifrostAgentCatalog.mockResolvedValue({ status: "cached" });
    mockReconcileBifrostVK.mockResolvedValue({
      vkValue: "sk-bf-alice",
      baseUrl: "https://swarm1.sphinx.chat:8181/anthropic/v1",
    });
    mockMintInvocationMacaroon.mockResolvedValue({
      token: "macaroon-b64",
      macaroonUserId: ACTOR,
      userId: auth.userId,
      runId: "deleg-uuid",
      expiresAt: expAfterDays(60),
      agentName: "strut-agent",
      orgId: "gh_acme",
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  // ── Gates ────────────────────────────────────────────────────────────

  it("skips when BIFROST_ENABLED is unset — strut is never called", async () => {
    delete process.env.BIFROST_ENABLED;
    const out = await ensureStrutDelegation(auth, swarm, { now: NOW });
    expect(out).toEqual({ status: "skipped-gate" });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockMintInvocationMacaroon).not.toHaveBeenCalled();
  });

  it("skips a workspace outside the BIFROST_ENABLED allow-list", async () => {
    process.env.BIFROST_ENABLED = "other-ws";
    expect((await ensureStrutDelegation(auth, swarm, { now: NOW })).status).toBe("skipped-gate");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips when the agent gate excludes strut-agent", async () => {
    process.env.BIFROST_ENABLED_AGENTS = "repo-agent,chat-agent";
    expect((await ensureStrutDelegation(auth, swarm, { now: NOW })).status).toBe("skipped-gate");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips without auth, and for the public viewer", async () => {
    expect((await ensureStrutDelegation(undefined, swarm, { now: NOW })).status).toBe("skipped-gate");
    expect((await ensureStrutDelegation({ ...auth, userId: "__public_viewer__" }, swarm, { now: NOW })).status).toBe(
      "skipped-gate",
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── The list call ────────────────────────────────────────────────────

  it("lists delegations at {mcp}/lab with the swarm key as x-api-token AND bearer", async () => {
    mockFetch.mockResolvedValueOnce(json(200, [{ actor: ACTOR, exp: expAfterDays(50), delegationId: "d1" }]));
    const out = await ensureStrutDelegation(auth, swarm, { now: NOW });
    expect(out).toEqual({ status: "fresh", actor: ACTOR });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://swarm1.sphinx.chat:3355/lab/llm/delegations");
    expect(init.method).toBe("GET");
    expect(init.headers["x-api-token"]).toBe("swarm-key");
    expect(init.headers.Authorization).toBe("Bearer swarm-key");
  });

  // ── Fresh ────────────────────────────────────────────────────────────

  it("a delegation with more than half its life left is left alone, columns synced", async () => {
    mockFetch.mockResolvedValueOnce(json(200, [{ actor: ACTOR, exp: expAfterDays(31), delegationId: "d1" }]));
    const out = await ensureStrutDelegation(auth, swarm, { now: NOW });
    expect(out.status).toBe("fresh");
    expect(mockMintInvocationMacaroon).not.toHaveBeenCalled();
    expect(mockReconcileBifrostVK).not.toHaveBeenCalled();
    // The desired-state record follows what strut holds.
    expect(mockMemberUpdateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "ws-1",
        userId: "u_alice",
        OR: [{ strutDelegationId: null }, { strutDelegationId: { not: "d1" } }],
      },
      data: { strutDelegationExp: new Date(expAfterDays(31)), strutDelegationId: "d1" },
    });
  });

  it("another actor's delegation does not count as ours", async () => {
    mockFetch
      .mockResolvedValueOnce(json(200, [{ actor: "bob-u_bob", exp: expAfterDays(59), delegationId: "dbob" }]))
      .mockResolvedValueOnce(json(200, { actor: ACTOR, exp: expAfterDays(60), delegationId: "deleg-uuid" }));
    const out = await ensureStrutDelegation(auth, swarm, { now: NOW });
    expect(out.status).toBe("pushed");
    expect(mockMintInvocationMacaroon).toHaveBeenCalledTimes(1);
  });

  // ── Push ─────────────────────────────────────────────────────────────

  it("mints the standing invocation and PUTs it when strut has none", async () => {
    mockFetch
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(200, { actor: ACTOR, exp: expAfterDays(60), delegationId: "deleg-uuid" }));

    const out = await ensureStrutDelegation(auth, swarm, { now: NOW });
    expect(out).toEqual({ status: "pushed", actor: ACTOR });

    // Same building blocks as getBifrostForLLM, in its order.
    expect(mockEnsureBifrostTrust).toHaveBeenCalledWith("ws-1");
    expect(mockEnsureBifrostAgentCatalog).toHaveBeenCalledWith("ws-1", "u_alice");
    expect(mockReconcileBifrostVK).toHaveBeenCalledWith("ws-1", "u_alice");

    // The mint: no new issuer code — strut-agent, an EXPLICIT 0 for
    // max_steps, the ceiling, 60 days.
    expect(mockMintInvocationMacaroon).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "u_alice",
      agentName: "strut-agent",
      maxCostUsd: STRUT_DELEGATION_DEFAULT_MAX_COST_USD,
      maxSteps: 0,
      ttlSeconds: STRUT_DELEGATION_TTL_SECONDS,
    });
    expect(STRUT_DELEGATION_TTL_SECONDS).toBe(60 * 24 * 3600);
    expect(STRUT_DELEGATION_DEFAULT_MAX_COST_USD).toBe(10_000);

    // The PUT: at the actor (= macaroon user_id) URL, both credentials,
    // the macaroon + the VK + the gateway ROOT (not the /anthropic/v1 URL).
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe(`https://swarm1.sphinx.chat:3355/lab/llm/delegations/${ACTOR}`);
    expect(init.method).toBe("PUT");
    expect(init.headers["x-api-token"]).toBe("swarm-key");
    expect(init.headers.Authorization).toBe("Bearer swarm-key");
    expect(JSON.parse(init.body)).toEqual({
      macaroon: "macaroon-b64",
      apiKey: "sk-bf-alice",
      baseUrl: "https://swarm1.sphinx.chat:8181",
    });

    // Desired state recorded: exp + id, never the token.
    expect(mockMemberUpdateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", userId: "u_alice" },
      data: { strutDelegationExp: new Date(expAfterDays(60)), strutDelegationId: "deleg-uuid" },
    });
    expect(JSON.stringify(mockMemberUpdateMany.mock.calls)).not.toContain("macaroon-b64");
  });

  it("re-mints when the stored delegation is past half its life", async () => {
    mockFetch
      .mockResolvedValueOnce(json(200, [{ actor: ACTOR, exp: expAfterDays(29), delegationId: "old" }]))
      .mockResolvedValueOnce(json(200, { actor: ACTOR, exp: expAfterDays(60), delegationId: "deleg-uuid" }));
    const out = await ensureStrutDelegation(auth, swarm, { now: NOW });
    expect(out.status).toBe("pushed");
    expect(mockMintInvocationMacaroon).toHaveBeenCalledTimes(1);
  });

  it("uses a caller-supplied actor without re-reading the user", async () => {
    mockFetch.mockResolvedValueOnce(json(200, [{ actor: "given-actor", exp: expAfterDays(59), delegationId: "d" }]));
    const out = await ensureStrutDelegation(auth, swarm, { now: NOW, actor: "given-actor" });
    expect(out).toEqual({ status: "fresh", actor: "given-actor" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("honors STRUT_DELEGATION_MAX_COST_USD on the mint", async () => {
    process.env.STRUT_DELEGATION_MAX_COST_USD = "25";
    mockFetch
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(200, { actor: ACTOR, exp: expAfterDays(60), delegationId: "deleg-uuid" }));
    await ensureStrutDelegation(auth, swarm, { now: NOW });
    expect(mockMintInvocationMacaroon.mock.calls[0][0].maxCostUsd).toBe(25);
  });

  // ── Failure posture ──────────────────────────────────────────────────

  it("a lab without the delegation routes (404 on the list) → unsupported, no mint", async () => {
    mockFetch.mockResolvedValueOnce(new Response("404 Not Found", { status: 404 }));
    const out = await ensureStrutDelegation(auth, swarm, { now: NOW });
    expect(out).toEqual({ status: "unsupported" });
    expect(mockMintInvocationMacaroon).not.toHaveBeenCalled();
  });

  it("a rejected PUT (strut's shape check) → failed, never a throw", async () => {
    mockFetch
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(400, { error: "the invocation's max_steps must be 0" }));
    await expect(ensureStrutDelegation(auth, swarm, { now: NOW })).resolves.toEqual({ status: "failed" });
  });

  it("a VK reconcile failure (no WorkspaceMember row) → failed before any mint", async () => {
    mockFetch.mockResolvedValueOnce(json(200, []));
    mockReconcileBifrostVK.mockRejectedValueOnce(new Error("User u_alice is not a member of workspace ws-1"));
    const out = await ensureStrutDelegation(auth, swarm, { now: NOW });
    expect(out).toEqual({ status: "failed" });
    expect(mockMintInvocationMacaroon).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("trust / catalog failures are non-fatal; the push still goes out", async () => {
    mockEnsureBifrostTrust.mockRejectedValueOnce(new Error("plugin down"));
    mockEnsureBifrostAgentCatalog.mockRejectedValueOnce(new Error("neo4j down"));
    mockFetch
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(200, { actor: ACTOR, exp: expAfterDays(60), delegationId: "deleg-uuid" }));
    expect((await ensureStrutDelegation(auth, swarm, { now: NOW })).status).toBe("pushed");
  });

  it("strut unreachable → failed", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(ensureStrutDelegation(auth, swarm, { now: NOW })).resolves.toEqual({ status: "failed" });
  });
});

describe("resolveStrutActor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is buildBifrostName: {login}-{userId} with a GitHub login", async () => {
    mockUserFindUnique.mockResolvedValue({ githubAuth: { githubUsername: "alice" } });
    expect(await resolveStrutActor("u_alice")).toBe("alice-u_alice");
  });

  it("falls back to the bare userId without one", async () => {
    mockUserFindUnique.mockResolvedValue({ githubAuth: null });
    expect(await resolveStrutActor("u_nologin")).toBe("u_nologin");
  });
});

describe("helpers", () => {
  afterEach(restoreEnv);

  it("strutLabBaseUrl points at the mcp /lab mount", () => {
    expect(strutLabBaseUrl("https://swarm1.sphinx.chat/api")).toBe("https://swarm1.sphinx.chat:3355/lab");
  });

  it("isPastHalfLife: measured against the 60-day TTL; unparseable = expired", () => {
    expect(isPastHalfLife(expAfterDays(31), NOW)).toBe(false);
    expect(isPastHalfLife(expAfterDays(30), NOW)).toBe(true);
    expect(isPastHalfLife(expAfterDays(-1), NOW)).toBe(true);
    expect(isPastHalfLife("not a date", NOW)).toBe(true);
  });

  it("isWithinRenewWindow: within N ms of exp, either string or Date", () => {
    expect(isWithinRenewWindow(expAfterDays(16), 15 * DAY_MS, NOW)).toBe(false);
    expect(isWithinRenewWindow(expAfterDays(15), 15 * DAY_MS, NOW)).toBe(true);
    expect(isWithinRenewWindow(new Date(expAfterDays(2)), 15 * DAY_MS, NOW)).toBe(true);
  });

  it("strutDelegationMaxCostUsd: env override, else the default; junk → default", () => {
    delete process.env.STRUT_DELEGATION_MAX_COST_USD;
    expect(strutDelegationMaxCostUsd()).toBe(10_000);
    process.env.STRUT_DELEGATION_MAX_COST_USD = "5";
    expect(strutDelegationMaxCostUsd()).toBe(5);
    process.env.STRUT_DELEGATION_MAX_COST_USD = "0";
    expect(strutDelegationMaxCostUsd()).toBe(10_000);
    process.env.STRUT_DELEGATION_MAX_COST_USD = "lots";
    expect(strutDelegationMaxCostUsd()).toBe(10_000);
  });
});
