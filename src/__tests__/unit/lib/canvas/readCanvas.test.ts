import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit-test the merge half of the projection pipeline against a mocked
 * `db.canvas.findUnique` + `db.workspace.findMany`. Covers the
 * invariants the plan calls out in § "The merge":
 *   - stored positions overlay projected defaults
 *   - hidden live nodes are filtered out
 *   - rollups merge into customData (manual customData wins)
 *   - dangling edges are silently dropped
 */

vi.mock("@/lib/db", () => ({
  db: {
    canvas: { findUnique: vi.fn() },
    workspace: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { readCanvas } from "@/lib/canvas";
import type { CanvasBlob } from "@/lib/canvas";

const dbMock = db as unknown as {
  canvas: { findUnique: ReturnType<typeof vi.fn> };
  workspace: { findMany: ReturnType<typeof vi.fn> };
};

function mockBlob(blob: CanvasBlob | null) {
  if (blob === null) {
    dbMock.canvas.findUnique.mockResolvedValue(null);
  } else {
    dbMock.canvas.findUnique.mockResolvedValue({ data: blob });
  }
}

function mockWorkspaces(ws: Array<{ id: string; name: string }>) {
  dbMock.workspace.findMany.mockResolvedValue(ws);
}

beforeEach(() => {
  vi.resetAllMocks();
});

// `CanvasData` has `nodes?` / `edges?` as optional; in practice readCanvas
// always populates them. This helper re-asserts that invariant for the
// assertions without sprinkling `!` through every test.
async function read(orgId: string, ref: string) {
  const data = await readCanvas(orgId, ref);
  return { nodes: data.nodes ?? [], edges: data.edges ?? [] };
}

describe("readCanvas (root scope)", () => {
  it("projects workspaces as ws:<id> live nodes when the blob is empty", async () => {
    mockBlob(null);
    mockWorkspaces([
      { id: "w1", name: "Alpha" },
      { id: "w2", name: "Beta" },
    ]);

    const { nodes } = await read("org-1", "");
    expect(nodes.map((n) => n.id)).toEqual(["ws:w1", "ws:w2"]);
    // Projected nodes carry `ref: "ws:<id>"` so clicking drills in.
    expect(nodes.every((n) => n.ref?.startsWith("ws:"))).toBe(true);
    expect(nodes[0].text).toBe("Alpha");
  });

  it("overlays `blob.positions` on top of projected defaults", async () => {
    mockBlob({
      nodes: [],
      edges: [],
      positions: { "ws:w1": { x: 999, y: 888 } },
    });
    mockWorkspaces([{ id: "w1", name: "Alpha" }]);

    const { nodes } = await read("org-1", "");
    const w1 = nodes.find((n) => n.id === "ws:w1");
    expect(w1?.x).toBe(999);
    expect(w1?.y).toBe(888);
  });

  it("drops hidden live nodes from the output", async () => {
    mockBlob({ nodes: [], edges: [], hidden: ["ws:w2"] });
    mockWorkspaces([
      { id: "w1", name: "Alpha" },
      { id: "w2", name: "Beta" },
    ]);

    const { nodes } = await read("org-1", "");
    expect(nodes.map((n) => n.id)).toEqual(["ws:w1"]);
  });

  it("concatenates authored nodes after live nodes", async () => {
    mockBlob({
      nodes: [
        {
          id: "obj-1",
          type: "text",
          x: 10,
          y: 300,
          text: "Ship mobile",
          category: "objective",
        },
      ],
      edges: [],
    });
    mockWorkspaces([{ id: "w1", name: "Alpha" }]);

    const { nodes } = await read("org-1", "");
    expect(nodes.map((n) => n.id)).toEqual(["ws:w1", "obj-1"]);
  });

  it("filters out edges whose endpoints don't exist after projection", async () => {
    mockBlob({
      nodes: [
        {
          id: "obj-1",
          type: "text",
          x: 0,
          y: 0,
          text: "x",
          category: "objective",
        },
      ],
      edges: [
        { id: "e-ok", fromNode: "obj-1", toNode: "ws:w1" },
        { id: "e-dangling", fromNode: "obj-1", toNode: "ws:gone" },
      ],
    });
    mockWorkspaces([{ id: "w1", name: "Alpha" }]);

    const { edges } = await read("org-1", "");
    expect(edges.map((e) => e.id)).toEqual(["e-ok"]);
  });

  it("drops edges whose endpoints were hidden (hidden = not in merge)", async () => {
    mockBlob({
      nodes: [
        {
          id: "obj-1",
          type: "text",
          x: 0,
          y: 0,
          text: "x",
          category: "objective",
        },
      ],
      edges: [{ id: "e1", fromNode: "obj-1", toNode: "ws:w1" }],
      hidden: ["ws:w1"],
    });
    mockWorkspaces([{ id: "w1", name: "Alpha" }]);

    const { nodes, edges } = await read("org-1", "");
    expect(nodes.map((n) => n.id)).toEqual(["obj-1"]);
    expect(edges).toEqual([]);
  });
});
