/**
 * Unit tests for resolveSphinxToolTarget — merge gating for send_sphinx_message.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findMany: vi.fn() },
  },
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccessById: vi.fn(),
}));

vi.mock("ai", () => ({
  tool: vi.fn((t: unknown) => t),
}));

import { db } from "@/lib/db";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { resolveSphinxToolTarget } from "@/lib/ai/sphinxTools";

const USER_ID = "user-1";
const WS_A = { workspaceId: "cuid-a", slug: "alpha" };
const WS_B = { workspaceId: "cuid-b", slug: "beta" };

type ConnectedRow = {
  id: string;
  slug: string;
  name: string;
  sphinxChatPubkey: string;
  swarm: { name: string } | null;
};

const CONNECTED_ROW_A: ConnectedRow = {
  id: "cuid-a",
  slug: "alpha",
  name: "Alpha",
  sphinxChatPubkey: "pubkey-a",
  swarm: { name: "swarm38" },
};
const CONNECTED_ROW_B: ConnectedRow = {
  id: "cuid-b",
  slug: "beta",
  name: "Beta",
  sphinxChatPubkey: "pubkey-b",
  swarm: { name: "swarm39" },
};

function asTarget(row: ConnectedRow) {
  return {
    workspaceId: row.id,
    workspaceSlug: row.slug,
    sphinxChatPubkey: row.sphinxChatPubkey,
    workspaceName: row.name,
    ...(row.swarm?.name ? { swarmDomain: `${row.swarm.name}.sphinx.chat` } : {}),
  };
}

const TARGET_A = asTarget(CONNECTED_ROW_A);
const TARGET_B = asTarget(CONNECTED_ROW_B);

// Connection + write-access are folded into the single findMany so the
// resolve step is one round trip regardless of workspace count.
const WRITABLE_ROLES = ["DEVELOPER", "PM", "ADMIN", "OWNER"];

function scopedPredicate(ids: string[]) {
  return expect.objectContaining({
    where: expect.objectContaining({
      id: { in: ids },
      sphinxEnabled: true,
      deleted: false,
      sphinxChatPubkey: { not: null },
      sphinxBotId: { not: null },
      sphinxBotSecret: { not: null },
      OR: [
        { ownerId: USER_ID },
        {
          members: {
            some: {
              userId: USER_ID,
              leftAt: null,
              role: { in: expect.arrayContaining(WRITABLE_ROLES) },
            },
          },
        },
      ],
    }),
    select: {
      id: true,
      slug: true,
      name: true,
      sphinxChatPubkey: true,
      swarm: { select: { name: true } },
    },
  });
}

describe("resolveSphinxToolTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([CONNECTED_ROW_A]);
  });

  it("resolves in a single query — never calls validateWorkspaceAccessById", async () => {
    (db.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      CONNECTED_ROW_A,
      CONNECTED_ROW_B,
    ]);

    await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "",
    });

    expect(db.workspace.findMany).toHaveBeenCalledTimes(1);
    expect(validateWorkspaceAccessById).not.toHaveBeenCalled();
  });

  it("excludes VIEWER and STAKEHOLDER from the writable-role predicate", async () => {
    await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A],
    });

    const call = (db.workspace.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const roles: string[] = call.where.OR[1].members.some.role.in;
    expect(roles).not.toContain("VIEWER");
    expect(roles).not.toContain("STAKEHOLDER");
    expect(roles.sort()).toEqual([...WRITABLE_ROLES].sort());
  });

  it("preserves conversation order even when the DB returns rows out of order", async () => {
    (db.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      CONNECTED_ROW_B,
      CONNECTED_ROW_A,
    ]);

    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "",
    });

    expect(result).toEqual([TARGET_A, TARGET_B]);
  });

  it("returns [] when no in-scope workspace is Sphinx-connected", async () => {
    (db.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A],
    });

    expect(result).toEqual([]);
    expect(db.workspace.findMany).toHaveBeenCalledWith(scopedPredicate(["cuid-a"]));
  });

  it("returns [] when readonly", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      readonly: true,
      workspaceConfigs: [WS_A],
    });

    expect(result).toEqual([]);
    expect(db.workspace.findMany).not.toHaveBeenCalled();
  });

  it("returns [] when silentPusher (auto-turns)", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      silentPusher: true,
      workspaceConfigs: [WS_A],
    });

    expect(result).toEqual([]);
    expect(db.workspace.findMany).not.toHaveBeenCalled();
  });

  it("returns [] for a public viewer", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      publicViewer: true,
      workspaceConfigs: [WS_A],
    });

    expect(result).toEqual([]);
    expect(db.workspace.findMany).not.toHaveBeenCalled();
  });

  it("returns [] when userId is missing", async () => {
    const result = await resolveSphinxToolTarget({
      userId: null,
      workspaceConfigs: [WS_A],
    });

    expect(result).toEqual([]);
    expect(db.workspace.findMany).not.toHaveBeenCalled();
  });

  it("merges every writable connected conversation workspace on org-root scope (currentCanvasRef === '')", async () => {
    (db.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      CONNECTED_ROW_A,
      CONNECTED_ROW_B,
    ]);

    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "",
    });

    expect(result).toEqual([TARGET_A, TARGET_B]);
    expect(db.workspace.findMany).toHaveBeenCalledWith(scopedPredicate(["cuid-a", "cuid-b"]));
  });

  it("omits swarmDomain when the workspace has no swarm row", async () => {
    (db.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...CONNECTED_ROW_A, swarm: null },
    ]);

    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A],
    });

    expect(result).toEqual([
      {
        workspaceId: "cuid-a",
        workspaceSlug: "alpha",
        sphinxChatPubkey: "pubkey-a",
        workspaceName: "Alpha",
      },
    ]);
    expect(result[0]).not.toHaveProperty("swarmDomain");
  });

  it("drops VIEWER-only workspaces at resolve on org-root scope (DB filters them out)", async () => {
    // The write gate lives in the query predicate; a VIEWER-only
    // workspace simply doesn't come back from findMany.
    (db.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([CONNECTED_ROW_A]);

    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "",
    });

    expect(result).toEqual([TARGET_A]);
    expect(db.workspace.findMany).toHaveBeenCalledWith(scopedPredicate(["cuid-a", "cuid-b"]));
  });

  it("includes an owner with no WorkspaceMember row on org-root scope via the ownerId branch", async () => {
    (db.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([CONNECTED_ROW_A]);

    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A],
      currentCanvasRef: "",
    });

    expect(result).toEqual([TARGET_A]);
    const call = (db.workspace.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where.OR).toContainEqual({ ownerId: USER_ID });
  });

  it("never queries a Sphinx workspace outside the conversation on org-root scope", async () => {
    (db.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([CONNECTED_ROW_A]);

    await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "",
    });

    expect(db.workspace.findMany).toHaveBeenCalledWith(scopedPredicate(["cuid-a", "cuid-b"]));
  });

  it("returns [] for multi-workspace initiative:* scope", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "initiative:init-1",
    });

    expect(result).toEqual([]);
    expect(db.workspace.findMany).not.toHaveBeenCalled();
  });

  it("returns [] for multi-workspace node:*, feature:*, and opaque scope", async () => {
    for (const ref of ["node:abc", "feature:xyz", "note:abc"]) {
      const result = await resolveSphinxToolTarget({
        userId: USER_ID,
        workspaceConfigs: [WS_A, WS_B],
        currentCanvasRef: ref,
      });
      expect(result).toEqual([]);
    }
    expect(db.workspace.findMany).not.toHaveBeenCalled();
  });

  it("returns [] for multi-workspace missing / undefined scope (does not treat it as org-root)", async () => {
    const missing = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
    });
    const explicitUndefined = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: undefined,
    });

    expect(missing).toEqual([]);
    expect(explicitUndefined).toEqual([]);
    expect(db.workspace.findMany).not.toHaveBeenCalled();
  });

  it("returns [] when multi-workspace ws: id is not in this conversation", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "ws:cuid-other",
    });

    expect(result).toEqual([]);
    expect(db.workspace.findMany).not.toHaveBeenCalled();
  });

  it("merges for single-workspace even when orgId is undefined", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A],
    });

    expect(result).toEqual([TARGET_A]);
    expect(db.workspace.findMany).toHaveBeenCalledWith(scopedPredicate(["cuid-a"]));
  });

  it("merges for multi-workspace only when currentCanvasRef is ws:<id> of a connected conversation workspace", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "ws:cuid-a",
    });

    expect(result).toEqual([TARGET_A]);
    expect(db.workspace.findMany).toHaveBeenCalledWith(scopedPredicate(["cuid-a"]));
  });
});
