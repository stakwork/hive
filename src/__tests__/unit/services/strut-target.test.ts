/**
 * Unit tests for `resolveStrutTarget` (`services/strut-target.ts`) — the
 * ONE place "which strut" lives.
 *
 * Coverage:
 *   - `code_change` / `embed` / `chat` run on the ORG's default workspace
 *     swarm (`resolveOrgSwarmWorkspaceForUser`): by workspace (its org is
 *     looked up) or by org login; NO_ORG_SWARM when nothing is reachable.
 *     `chat` is the row that moved (one strut per org, 2026-09-24).
 *   - `benchmark` runs on the workspace's OWN swarm, access-checked:
 *     not found, access denied (owner OR member passes), swarm missing /
 *     not active / no key.
 *   - The target: swarm id, lab base, decrypted key, the actor string; a
 *     decrypt failure is reported, never thrown.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockWorkspaceFindFirst, mockOrgSwarmWorkspace, mockResolveStrutActor, mockDecrypt } = vi.hoisted(() => ({
  mockWorkspaceFindFirst: vi.fn(),
  mockOrgSwarmWorkspace: vi.fn(),
  mockResolveStrutActor: vi.fn(),
  mockDecrypt: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { workspace: { findFirst: mockWorkspaceFindFirst } } }));
vi.mock("@/lib/helpers/org-workspace", () => ({ resolveOrgSwarmWorkspaceForUser: mockOrgSwarmWorkspace }));
vi.mock("@/services/bifrost/strut-delegation", () => ({ resolveStrutActor: mockResolveStrutActor }));
vi.mock("@/lib/encryption", () => ({
  EncryptionService: { getInstance: () => ({ decryptField: mockDecrypt }) },
}));

import { describeStrutTargetError, resolveStrutTarget } from "@/services/strut-target";

const USER = "user-1";
const SWARM = { id: "swarm-1", status: "ACTIVE", swarmUrl: "https://acme.sphinx.chat/api", swarmApiKey: "enc-key" };

function ownWorkspace(over: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    slug: "acme",
    ownerId: USER,
    sourceControlOrgId: "org-1",
    swarm: SWARM,
    members: [],
    ...over,
  };
}

function orgWorkspace(over: Record<string, unknown> = {}) {
  return {
    id: "ws-default",
    slug: "acme-default",
    sourceControlOrgId: "org-1",
    swarm: { ...SWARM, id: "swarm-default", swarmUrl: "https://default.sphinx.chat/api" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveStrutActor.mockResolvedValue("alice-user-1");
  mockDecrypt.mockImplementation((_f: string, v: string) => `dec(${v})`);
});

describe("resolveStrutTarget — org-default policy (code_change, embed, chat)", () => {
  it("code_change: looks up the workspace's org and returns the org default swarm", async () => {
    mockWorkspaceFindFirst.mockResolvedValue({ sourceControlOrg: { githubLogin: "acme-gh" } });
    mockOrgSwarmWorkspace.mockResolvedValue(orgWorkspace());

    const out = await resolveStrutTarget({ purpose: "code_change", workspaceId: "ws-1", userId: USER });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(mockOrgSwarmWorkspace).toHaveBeenCalledWith("acme-gh", USER);
    expect(out.target).toEqual({
      swarmId: "swarm-default",
      workspaceId: "ws-default",
      workspaceSlug: "acme-default",
      orgId: "org-1",
      swarmUrl: "https://default.sphinx.chat/api",
      mcpBase: "https://default.sphinx.chat:3355",
      labBase: "https://default.sphinx.chat:3355/lab",
      swarmApiKey: "dec(enc-key)",
      actor: "alice-user-1",
    });
    expect(mockResolveStrutActor).toHaveBeenCalledWith(USER);
  });

  it("chat: Jamie's dispatch lands on the org default swarm, whatever workspace it names", async () => {
    mockWorkspaceFindFirst.mockResolvedValue({ sourceControlOrg: { githubLogin: "acme-gh" } });
    mockOrgSwarmWorkspace.mockResolvedValue(orgWorkspace());
    const out = await resolveStrutTarget({ purpose: "chat", workspaceSlug: "acme", userId: USER });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(mockOrgSwarmWorkspace).toHaveBeenCalledWith("acme-gh", USER);
    expect(out.target).toMatchObject({ swarmId: "swarm-default", workspaceId: "ws-default", workspaceSlug: "acme-default" });
    // The named workspace is only read for its org; the access check is on
    // the org default workspace, inside resolveOrgSwarmWorkspaceForUser.
    expect(mockWorkspaceFindFirst.mock.calls[0][0].select).toEqual({ sourceControlOrg: { select: { githubLogin: true } } });
  });

  it("embed: resolves by org login without a workspace in hand", async () => {
    mockOrgSwarmWorkspace.mockResolvedValue(orgWorkspace());
    const out = await resolveStrutTarget({ purpose: "embed", orgGithubLogin: "acme-gh", userId: USER });
    expect(out.ok).toBe(true);
    expect(mockWorkspaceFindFirst).not.toHaveBeenCalled();
    expect(mockOrgSwarmWorkspace).toHaveBeenCalledWith("acme-gh", USER);
  });

  it("NO_ORG_SWARM when no workspace in the org has a swarm the user can reach", async () => {
    mockOrgSwarmWorkspace.mockResolvedValue(null);
    const out = await resolveStrutTarget({ purpose: "embed", orgGithubLogin: "acme-gh", userId: USER });
    expect(out).toEqual({ ok: false, error: { type: "NO_ORG_SWARM" } });
  });

  it("NO_ORG_SWARM when the workspace has no source-control org", async () => {
    mockWorkspaceFindFirst.mockResolvedValue({ sourceControlOrg: null });
    const out = await resolveStrutTarget({ purpose: "code_change", workspaceSlug: "acme", userId: USER });
    expect(out).toEqual({ ok: false, error: { type: "NO_ORG_SWARM" } });
    expect(mockOrgSwarmWorkspace).not.toHaveBeenCalled();
  });

  it("WORKSPACE_NOT_FOUND for an unknown workspace, and with nothing to resolve by", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(null);
    expect(await resolveStrutTarget({ purpose: "code_change", workspaceId: "nope", userId: USER })).toEqual({
      ok: false,
      error: { type: "WORKSPACE_NOT_FOUND" },
    });
    expect(await resolveStrutTarget({ purpose: "code_change", userId: USER })).toEqual({
      ok: false,
      error: { type: "WORKSPACE_NOT_FOUND" },
    });
  });

  it("SWARM_NOT_CONFIGURED when the org swarm has no url or key", async () => {
    mockOrgSwarmWorkspace.mockResolvedValue(orgWorkspace({ swarm: { ...SWARM, swarmApiKey: null } }));
    const out = await resolveStrutTarget({ purpose: "embed", orgGithubLogin: "acme-gh", userId: USER });
    expect(out).toEqual({ ok: false, error: { type: "SWARM_NOT_CONFIGURED" } });
  });

  it("reports a decrypt failure instead of throwing", async () => {
    mockOrgSwarmWorkspace.mockResolvedValue(orgWorkspace());
    mockDecrypt.mockImplementation(() => {
      throw new Error("bad key");
    });
    const out = await resolveStrutTarget({ purpose: "embed", orgGithubLogin: "acme-gh", userId: USER });
    expect(out).toEqual({ ok: false, error: { type: "DECRYPT_FAILED", message: "bad key" } });
  });
});

describe("resolveStrutTarget — workspace policy (benchmark)", () => {
  it("benchmark: the workspace's own swarm, by slug", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(ownWorkspace());
    const out = await resolveStrutTarget({ purpose: "benchmark", workspaceSlug: "acme", userId: USER });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.target).toMatchObject({
      swarmId: "swarm-1",
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      orgId: "org-1",
      labBase: "https://acme.sphinx.chat:3355/lab",
      swarmApiKey: "dec(enc-key)",
      actor: "alice-user-1",
    });
    expect(mockOrgSwarmWorkspace).not.toHaveBeenCalled();
    // Access-checked in the same query: the user's live membership.
    expect(mockWorkspaceFindFirst.mock.calls[0][0].where).toEqual({ slug: "acme", deleted: false });
    expect(mockWorkspaceFindFirst.mock.calls[0][0].select.members.where).toEqual({ userId: USER, leftAt: null });
  });

  it("benchmark: by id, a member (not the owner) passes", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(ownWorkspace({ ownerId: "someone-else", members: [{ userId: USER }] }));
    const out = await resolveStrutTarget({ purpose: "benchmark", workspaceId: "ws-1", userId: USER });
    expect(out.ok).toBe(true);
    expect(mockWorkspaceFindFirst.mock.calls[0][0].where).toEqual({ id: "ws-1", deleted: false });
  });

  it("ACCESS_DENIED for a non-member, before any credential is decrypted", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(ownWorkspace({ ownerId: "someone-else", members: [] }));
    const out = await resolveStrutTarget({ purpose: "benchmark", workspaceSlug: "acme", userId: USER });
    expect(out).toEqual({ ok: false, error: { type: "ACCESS_DENIED" } });
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it("WORKSPACE_NOT_FOUND / SWARM_NOT_CONFIGURED / SWARM_NOT_ACTIVE", async () => {
    mockWorkspaceFindFirst.mockResolvedValueOnce(null);
    expect(await resolveStrutTarget({ purpose: "benchmark", workspaceSlug: "x", userId: USER })).toEqual({
      ok: false,
      error: { type: "WORKSPACE_NOT_FOUND" },
    });
    mockWorkspaceFindFirst.mockResolvedValueOnce(ownWorkspace({ swarm: null }));
    expect(await resolveStrutTarget({ purpose: "benchmark", workspaceSlug: "x", userId: USER })).toEqual({
      ok: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    });
    mockWorkspaceFindFirst.mockResolvedValueOnce(ownWorkspace({ swarm: { ...SWARM, swarmApiKey: null } }));
    expect(await resolveStrutTarget({ purpose: "benchmark", workspaceSlug: "x", userId: USER })).toEqual({
      ok: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    });
    mockWorkspaceFindFirst.mockResolvedValueOnce(ownWorkspace({ swarm: { ...SWARM, status: "PENDING" } }));
    expect(await resolveStrutTarget({ purpose: "benchmark", workspaceSlug: "x", userId: USER })).toEqual({
      ok: false,
      error: { type: "SWARM_NOT_ACTIVE", status: "PENDING" },
    });
  });
});

describe("describeStrutTargetError", () => {
  it("has a sentence for every error", () => {
    expect(describeStrutTargetError({ type: "NO_ORG_SWARM" })).toMatch(/No swarm/);
    expect(describeStrutTargetError({ type: "SWARM_NOT_ACTIVE", status: "FAILED" })).toContain("FAILED");
    expect(describeStrutTargetError({ type: "DECRYPT_FAILED", message: "m" })).toContain("m");
  });
});
