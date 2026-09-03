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

const CONNECTED_ROW_A = { id: "cuid-a", slug: "alpha" };
const CONNECTED_ROW_B = { id: "cuid-b", slug: "beta" };

function scopedPredicate(ids: string[]) {
  return expect.objectContaining({
    where: expect.objectContaining({
      id: { in: ids },
      sphinxEnabled: true,
      deleted: false,
      sphinxChatPubkey: { not: null },
      sphinxBotId: { not: null },
      sphinxBotSecret: { not: null },
    }),
  });
}

describe("resolveSphinxToolTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([CONNECTED_ROW_A]);
    (validateWorkspaceAccessById as ReturnType<typeof vi.fn>).mockResolvedValue({
      canWrite: true,
    });
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

    expect(result).toEqual([
      { workspaceId: "cuid-a", workspaceSlug: "alpha" },
      { workspaceId: "cuid-b", workspaceSlug: "beta" },
    ]);
    expect(db.workspace.findMany).toHaveBeenCalledWith(scopedPredicate(["cuid-a", "cuid-b"]));
  });

  it("drops VIEWER-only workspaces at resolve on org-root scope", async () => {
    (db.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      CONNECTED_ROW_A,
      CONNECTED_ROW_B,
    ]);
    (validateWorkspaceAccessById as ReturnType<typeof vi.fn>).mockImplementation(
      async (workspaceId: string) => ({ canWrite: workspaceId === "cuid-a" }),
    );

    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "",
    });

    expect(result).toEqual([{ workspaceId: "cuid-a", workspaceSlug: "alpha" }]);
  });

  it("includes an owner with no WorkspaceMember row on org-root scope", async () => {
    (db.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([CONNECTED_ROW_A]);
    (validateWorkspaceAccessById as ReturnType<typeof vi.fn>).mockResolvedValue({
      canWrite: true,
    });

    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A],
      currentCanvasRef: "",
    });

    expect(result).toEqual([{ workspaceId: "cuid-a", workspaceSlug: "alpha" }]);
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

    expect(result).toEqual([{ workspaceId: "cuid-a", workspaceSlug: "alpha" }]);
    expect(db.workspace.findMany).toHaveBeenCalledWith(scopedPredicate(["cuid-a"]));
  });

  it("merges for multi-workspace only when currentCanvasRef is ws:<id> of a connected conversation workspace", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "ws:cuid-a",
    });

    expect(result).toEqual([{ workspaceId: "cuid-a", workspaceSlug: "alpha" }]);
    expect(db.workspace.findMany).toHaveBeenCalledWith(scopedPredicate(["cuid-a"]));
  });
});
