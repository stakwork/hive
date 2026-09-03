/**
 * Unit tests for resolveSphinxToolTarget — merge gating for send_sphinx_message.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn() },
  },
}));

vi.mock("ai", () => ({
  tool: vi.fn((t: unknown) => t),
}));

import { db } from "@/lib/db";
import { resolveSphinxToolTarget } from "@/lib/ai/sphinxTools";

const USER_ID = "user-1";
const WS_A = { workspaceId: "cuid-a", slug: "alpha" };
const WS_B = { workspaceId: "cuid-b", slug: "beta" };

const CONNECTED_ROW = { id: "cuid-a", slug: "alpha" };

function connectedPredicate(id: string) {
  return expect.objectContaining({
    where: expect.objectContaining({
      id,
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
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(CONNECTED_ROW);
  });

  it("returns null when no in-scope workspace is Sphinx-connected", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A],
    });

    expect(result).toBeNull();
    expect(db.workspace.findFirst).toHaveBeenCalledWith(connectedPredicate("cuid-a"));
  });

  it("returns null when readonly", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      readonly: true,
      workspaceConfigs: [WS_A],
    });

    expect(result).toBeNull();
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when silentPusher (auto-turns)", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      silentPusher: true,
      workspaceConfigs: [WS_A],
    });

    expect(result).toBeNull();
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
  });

  it("returns null for a public viewer", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      publicViewer: true,
      workspaceConfigs: [WS_A],
    });

    expect(result).toBeNull();
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when userId is missing", async () => {
    const result = await resolveSphinxToolTarget({
      userId: null,
      workspaceConfigs: [WS_A],
    });

    expect(result).toBeNull();
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
  });

  it("returns null for multi-workspace org-root scope", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "",
    });

    expect(result).toBeNull();
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
  });

  it("returns null for multi-workspace initiative:* scope", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "initiative:init-1",
    });

    expect(result).toBeNull();
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
  });

  it("returns null for multi-workspace missing / non-ws: scope", async () => {
    const missing = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
    });
    const other = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "note:abc",
    });

    expect(missing).toBeNull();
    expect(other).toBeNull();
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when multi-workspace ws: id is not in this conversation", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "ws:cuid-other",
    });

    expect(result).toBeNull();
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
  });

  it("does not fall back to the sole connected workspace in a conversation", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "initiative:init-1",
    });

    expect(result).toBeNull();
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
  });

  it("merges for single-workspace even when orgId is undefined", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A],
    });

    expect(result).toEqual({ workspaceId: "cuid-a", workspaceSlug: "alpha" });
    expect(db.workspace.findFirst).toHaveBeenCalledWith(connectedPredicate("cuid-a"));
  });

  it("merges for multi-workspace only when currentCanvasRef is ws:<id> of a connected conversation workspace", async () => {
    const result = await resolveSphinxToolTarget({
      userId: USER_ID,
      workspaceConfigs: [WS_A, WS_B],
      currentCanvasRef: "ws:cuid-a",
    });

    expect(result).toEqual({ workspaceId: "cuid-a", workspaceSlug: "alpha" });
    expect(db.workspace.findFirst).toHaveBeenCalledWith(connectedPredicate("cuid-a"));
  });
});
