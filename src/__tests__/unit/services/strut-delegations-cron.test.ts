/**
 * Unit tests for `runStrutDelegationReconcile`
 * (`services/strut-delegations-cron.ts`).
 *
 * Coverage:
 *   - Only Bifrost-enabled workspaces with a usable swarm are read; a lab
 *     without the delegation routes is skipped.
 *   - Active member on record, missing from strut → re-minted + PUT.
 *   - Active member within 15 days of exp → re-minted; well inside → not.
 *   - Active member never pushed (no record either side) → left alone.
 *   - Departed member (leftAt) → DELETE + columns cleared.
 *   - Unknown actors strut lists are never touched.
 *   - Per-member failures are recorded and the pass continues.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockWorkspaceFindMany,
  mockMemberFindMany,
  mockMemberUpdateMany,
  mockListStrutDelegations,
  mockPushStrutDelegation,
  mockDeleteStrutDelegation,
} = vi.hoisted(() => ({
  mockWorkspaceFindMany: vi.fn(),
  mockMemberFindMany: vi.fn(),
  mockMemberUpdateMany: vi.fn(),
  mockListStrutDelegations: vi.fn(),
  mockPushStrutDelegation: vi.fn(),
  mockDeleteStrutDelegation: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findMany: mockWorkspaceFindMany },
    workspaceMember: { findMany: mockMemberFindMany, updateMany: mockMemberUpdateMany },
  },
}));
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      decryptField: (_field: string, value: string) => `plain:${value}`,
    }),
  },
}));
vi.mock("@/services/bifrost/reconciler", () => ({
  buildBifrostName: (userId: string, login: string | null) => (login ? `${login}-${userId}` : userId),
}));
vi.mock("@/services/bifrost/strut-delegation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/bifrost/strut-delegation")>();
  return {
    ...actual,
    listStrutDelegations: mockListStrutDelegations,
    pushStrutDelegation: mockPushStrutDelegation,
    deleteStrutDelegation: mockDeleteStrutDelegation,
  };
});

import { runStrutDelegationReconcile } from "@/services/strut-delegations-cron";
import { StrutDelegationsUnsupportedError } from "@/services/bifrost/strut-delegation";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const DAY_MS = 24 * 3600 * 1000;
const expAfterDays = (d: number) => new Date(NOW.getTime() + d * DAY_MS);

const WS = {
  id: "ws-1",
  slug: "acme",
  swarm: { swarmUrl: "https://swarm1.sphinx.chat/api", swarmApiKey: "enc-key" },
};
const TARGET = { labBase: "https://swarm1.sphinx.chat:3355/lab", swarmApiKey: "plain:enc-key" };

function member(
  userId: string,
  login: string | null,
  extra: Partial<{ leftAt: Date | null; strutDelegationExp: Date | null; strutDelegationId: string | null }> = {},
) {
  return {
    userId,
    leftAt: null,
    strutDelegationExp: null,
    strutDelegationId: null,
    user: { githubAuth: login ? { githubUsername: login } : null },
    ...extra,
  };
}

const ORIGINAL_ENV = {
  BIFROST_ENABLED: process.env.BIFROST_ENABLED,
  BIFROST_ENABLED_AGENTS: process.env.BIFROST_ENABLED_AGENTS,
};

describe("runStrutDelegationReconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BIFROST_ENABLED = "acme";
    delete process.env.BIFROST_ENABLED_AGENTS;
    mockWorkspaceFindMany.mockResolvedValue([WS]);
    mockMemberFindMany.mockResolvedValue([]);
    mockMemberUpdateMany.mockResolvedValue({ count: 1 });
    mockListStrutDelegations.mockResolvedValue([]);
    mockPushStrutDelegation.mockResolvedValue({ actor: "x", exp: expAfterDays(60).toISOString(), delegationId: "new" });
    mockDeleteStrutDelegation.mockResolvedValue(true);
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("skips workspaces the BIFROST_ENABLED gate excludes, and ones without a swarm key", async () => {
    mockWorkspaceFindMany.mockResolvedValue([
      { ...WS, slug: "not-enrolled" },
      { ...WS, id: "ws-2", slug: "acme", swarm: { swarmUrl: "https://x/api", swarmApiKey: null } },
    ]);
    const r = await runStrutDelegationReconcile({ now: NOW });
    expect(r.workspacesSkipped).toBe(2);
    expect(r.workspacesProcessed).toBe(0);
    expect(mockListStrutDelegations).not.toHaveBeenCalled();
  });

  it("reads the lab with the decrypted swarm key, at the mcp /lab mount", async () => {
    await runStrutDelegationReconcile({ now: NOW });
    expect(mockListStrutDelegations).toHaveBeenCalledWith(TARGET);
    expect(mockWorkspaceFindMany.mock.calls[0][0].where).toMatchObject({
      deleted: false,
      sourceControlOrgId: { not: null },
      swarm: { isNot: null },
    });
  });

  it("a lab without the delegation routes counts as skipped, not an error", async () => {
    mockListStrutDelegations.mockRejectedValue(new StrutDelegationsUnsupportedError(TARGET.labBase));
    const r = await runStrutDelegationReconcile({ now: NOW });
    expect(r).toMatchObject({ success: true, workspacesSkipped: 1, workspacesProcessed: 0, errors: [] });
  });

  it("a list failure is recorded per workspace and the pass goes on", async () => {
    mockWorkspaceFindMany.mockResolvedValue([WS, { ...WS, id: "ws-2", slug: "acme" }]);
    mockListStrutDelegations.mockRejectedValueOnce(new Error("502")).mockResolvedValueOnce([]);
    const r = await runStrutDelegationReconcile({ now: NOW });
    expect(r.success).toBe(false);
    expect(r.errors).toEqual([{ workspaceSlug: "acme", error: expect.stringContaining("502") }]);
    expect(r.workspacesProcessed).toBe(1);
  });

  it("re-mints for an active member on record whose delegation strut lost (a wiped volume heals)", async () => {
    mockMemberFindMany.mockResolvedValue([
      member("u_alice", "alice", { strutDelegationExp: expAfterDays(40), strutDelegationId: "old" }),
    ]);
    mockListStrutDelegations.mockResolvedValue([]);
    const r = await runStrutDelegationReconcile({ now: NOW });
    expect(r.pushed).toBe(1);
    expect(mockPushStrutDelegation).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "u_alice",
      swarmUrl: WS.swarm.swarmUrl,
      target: TARGET,
    });
  });

  it("re-mints inside the last 15 days of the delegation strut holds; not before", async () => {
    mockMemberFindMany.mockResolvedValue([
      member("u_alice", "alice", { strutDelegationId: "a" }),
      member("u_bob", "bob", { strutDelegationId: "b" }),
    ]);
    mockListStrutDelegations.mockResolvedValue([
      { actor: "alice-u_alice", exp: expAfterDays(14).toISOString(), delegationId: "a" },
      { actor: "bob-u_bob", exp: expAfterDays(16).toISOString(), delegationId: "b" },
    ]);
    const r = await runStrutDelegationReconcile({ now: NOW });
    expect(r.pushed).toBe(1);
    expect(mockPushStrutDelegation.mock.calls[0][0].userId).toBe("u_alice");
  });

  it("strut's entry counts as desired even when the record is empty; the record is then synced", async () => {
    mockMemberFindMany.mockResolvedValue([member("u_alice", "alice")]);
    mockListStrutDelegations.mockResolvedValue([
      { actor: "alice-u_alice", exp: expAfterDays(40).toISOString(), delegationId: "a" },
    ]);
    const r = await runStrutDelegationReconcile({ now: NOW });
    expect(r.pushed).toBe(0);
    expect(mockMemberUpdateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", userId: "u_alice" },
      data: { strutDelegationExp: expAfterDays(40), strutDelegationId: "a" },
    });
  });

  it("an active member with nothing on either side is left alone (the first visit pushes)", async () => {
    mockMemberFindMany.mockResolvedValue([member("u_carol", "carol")]);
    const r = await runStrutDelegationReconcile({ now: NOW });
    expect(r.pushed).toBe(0);
    expect(mockPushStrutDelegation).not.toHaveBeenCalled();
    expect(mockMemberUpdateMany).not.toHaveBeenCalled();
  });

  it("deletes the delegation of a member who left and clears the columns", async () => {
    mockMemberFindMany.mockResolvedValue([
      member("u_dave", "dave", {
        leftAt: new Date("2026-09-01T00:00:00Z"),
        strutDelegationExp: expAfterDays(40),
        strutDelegationId: "d",
      }),
    ]);
    mockListStrutDelegations.mockResolvedValue([
      { actor: "dave-u_dave", exp: expAfterDays(40).toISOString(), delegationId: "d" },
    ]);
    const r = await runStrutDelegationReconcile({ now: NOW });
    expect(r.deleted).toBe(1);
    expect(mockDeleteStrutDelegation).toHaveBeenCalledWith(TARGET, "dave-u_dave");
    expect(mockMemberUpdateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", userId: "u_dave" },
      data: { strutDelegationExp: null, strutDelegationId: null },
    });
    expect(mockPushStrutDelegation).not.toHaveBeenCalled();
  });

  it("a departed member strut no longer lists still gets the columns cleared, without a DELETE", async () => {
    mockMemberFindMany.mockResolvedValue([
      member("u_dave", null, { leftAt: new Date(), strutDelegationId: "d", strutDelegationExp: expAfterDays(1) }),
    ]);
    const r = await runStrutDelegationReconcile({ now: NOW });
    expect(r.deleted).toBe(0);
    expect(mockDeleteStrutDelegation).not.toHaveBeenCalled();
    expect(mockMemberUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("never touches actors strut lists that hive does not know", async () => {
    mockListStrutDelegations.mockResolvedValue([
      { actor: "someone-else", exp: expAfterDays(1).toISOString(), delegationId: "z" },
    ]);
    const r = await runStrutDelegationReconcile({ now: NOW });
    expect(r).toMatchObject({ pushed: 0, deleted: 0, errors: [] });
    expect(mockDeleteStrutDelegation).not.toHaveBeenCalled();
  });

  it("a failed push is recorded with the actor and the other members still run", async () => {
    mockMemberFindMany.mockResolvedValue([
      member("u_alice", "alice", { strutDelegationId: "a" }),
      member("u_bob", "bob", { strutDelegationId: "b" }),
    ]);
    mockPushStrutDelegation
      .mockRejectedValueOnce(new Error("PUT returned 400: bad macaroon"))
      .mockResolvedValueOnce({ actor: "bob-u_bob", exp: expAfterDays(60).toISOString(), delegationId: "b2" });
    const r = await runStrutDelegationReconcile({ now: NOW });
    expect(r.pushed).toBe(1);
    expect(r.success).toBe(false);
    expect(r.errors).toEqual([
      { workspaceSlug: "acme", actor: "alice-u_alice", error: expect.stringContaining("400") },
    ]);
  });

  it("scopes to one workspace slug when asked", async () => {
    await runStrutDelegationReconcile({ now: NOW, workspaceSlug: "acme" });
    expect(mockWorkspaceFindMany.mock.calls[0][0].where.slug).toBe("acme");
  });
});
