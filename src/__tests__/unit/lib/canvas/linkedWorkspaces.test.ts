import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit-test the root-canvas edge walker that powers the agent's
 * "which workspace is this initiative linked to?" prompt hint.
 *
 * Covers:
 *   - both edge directions (`ws ↔ initiative` and `initiative ↔ ws`),
 *   - de-duping repeated edges,
 *   - preserving edge-appearance order in the returned list,
 *   - filtering out workspaces from a different org (defense in
 *     depth — a stale cross-org edge must not leak into the prompt),
 *   - filtering out deleted workspaces,
 *   - graceful empty-result on missing canvas / malformed blob.
 */

vi.mock("@/lib/db", () => ({
  db: {
    canvas: { findUnique: vi.fn() },
    workspace: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { getLinkedWorkspacesForInitiative } from "@/lib/canvas/linkedWorkspaces";

const dbMock = db as unknown as {
  canvas: { findUnique: ReturnType<typeof vi.fn> };
  workspace: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLinkedWorkspacesForInitiative", () => {
  it("returns [] when there is no root canvas row", async () => {
    dbMock.canvas.findUnique.mockResolvedValue(null);
    const out = await getLinkedWorkspacesForInitiative("org-1", "init-1");
    expect(out).toEqual([]);
    expect(dbMock.workspace.findMany).not.toHaveBeenCalled();
  });

  it("returns [] when the blob has no edges", async () => {
    dbMock.canvas.findUnique.mockResolvedValue({ data: { nodes: [] } });
    const out = await getLinkedWorkspacesForInitiative("org-1", "init-1");
    expect(out).toEqual([]);
    expect(dbMock.workspace.findMany).not.toHaveBeenCalled();
  });

  it("walks both edge directions and preserves edge order", async () => {
    dbMock.canvas.findUnique.mockResolvedValue({
      data: {
        edges: [
          // ws → initiative (first appearance: hive)
          { fromNode: "ws:hive", toNode: "initiative:init-1" },
          // unrelated edge
          { fromNode: "ws:hive", toNode: "initiative:other" },
          // initiative → ws (reverse direction: stakgraph)
          { fromNode: "initiative:init-1", toNode: "ws:stakgraph" },
          // duplicate of hive edge — must be deduped
          { fromNode: "initiative:init-1", toNode: "ws:hive" },
        ],
      },
    });
    dbMock.workspace.findMany.mockResolvedValue([
      // Returned in arbitrary DB order — the helper must
      // re-order back to edge-appearance order.
      { id: "stakgraph", slug: "stakgraph", name: "Stakgraph" },
      { id: "hive", slug: "hive", name: "Hive" },
    ]);

    const out = await getLinkedWorkspacesForInitiative("org-1", "init-1");
    expect(out).toEqual([
      { id: "hive", slug: "hive", name: "Hive" },
      { id: "stakgraph", slug: "stakgraph", name: "Stakgraph" },
    ]);

    // Sanity: filtered to this org and not-deleted.
    const args = dbMock.workspace.findMany.mock.calls[0][0];
    expect(args.where.sourceControlOrgId).toBe("org-1");
    expect(args.where.deleted).toBe(false);
    expect(args.where.id.in.sort()).toEqual(["hive", "stakgraph"]);
  });

  it("drops linked ids whose workspaces don't belong to the org", async () => {
    dbMock.canvas.findUnique.mockResolvedValue({
      data: {
        edges: [
          { fromNode: "ws:hive", toNode: "initiative:init-1" },
          { fromNode: "ws:foreign", toNode: "initiative:init-1" },
        ],
      },
    });
    // The org filter on the workspace lookup naturally excludes
    // `ws:foreign`. We mirror that here — only `hive` comes back.
    dbMock.workspace.findMany.mockResolvedValue([
      { id: "hive", slug: "hive", name: "Hive" },
    ]);

    const out = await getLinkedWorkspacesForInitiative("org-1", "init-1");
    expect(out).toEqual([
      { id: "hive", slug: "hive", name: "Hive" },
    ]);
  });

  it("ignores edges that don't touch the target initiative", async () => {
    dbMock.canvas.findUnique.mockResolvedValue({
      data: {
        edges: [
          { fromNode: "ws:hive", toNode: "initiative:other" },
          { fromNode: "note:abc", toNode: "ws:hive" },
        ],
      },
    });
    const out = await getLinkedWorkspacesForInitiative("org-1", "init-1");
    expect(out).toEqual([]);
    // No workspace lookup happens when no candidates were found.
    expect(dbMock.workspace.findMany).not.toHaveBeenCalled();
  });

  it("returns [] when orgId or initiativeId is empty", async () => {
    expect(await getLinkedWorkspacesForInitiative("", "init-1")).toEqual([]);
    expect(await getLinkedWorkspacesForInitiative("org-1", "")).toEqual([]);
    expect(dbMock.canvas.findUnique).not.toHaveBeenCalled();
  });

  it("swallows DB errors and returns []", async () => {
    dbMock.canvas.findUnique.mockRejectedValue(new Error("db down"));
    const out = await getLinkedWorkspacesForInitiative("org-1", "init-1");
    expect(out).toEqual([]);
  });
});
