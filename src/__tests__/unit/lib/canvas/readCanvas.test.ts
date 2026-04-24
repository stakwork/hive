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
    canvas: { findUnique: vi.fn(), findMany: vi.fn() },
    workspace: { findMany: vi.fn(), findFirst: vi.fn() },
    repository: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { readCanvas } from "@/lib/canvas";
import type { CanvasBlob } from "@/lib/canvas";

const dbMock = db as unknown as {
  canvas: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  workspace: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  repository: { findMany: ReturnType<typeof vi.fn> };
};

function mockBlob(blob: CanvasBlob | null) {
  if (blob === null) {
    dbMock.canvas.findUnique.mockResolvedValue(null);
  } else {
    dbMock.canvas.findUnique.mockResolvedValue({ data: blob });
  }
}

/**
 * Mock a `db.workspace.findMany` result. Matches the projector's real
 * query shape, including the `_count: { repositories }` aggregate that
 * drives the "N repos" footer. Individual test entries can override the
 * count; omitting it defaults to 0 to keep test noise down.
 */
function mockWorkspaces(
  ws: Array<{ id: string; name: string; repositoryCount?: number }>,
) {
  dbMock.workspace.findMany.mockResolvedValue(
    ws.map(({ repositoryCount, ...rest }) => ({
      ...rest,
      _count: { repositories: repositoryCount ?? 0 },
    })),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default: child-canvas rollup query finds nothing. Individual tests
  // can override when they want to exercise the rollup path.
  dbMock.canvas.findMany.mockResolvedValue([]);
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

  it("stamps a pluralized 'N repo(s)' footer into workspace customData", async () => {
    // Pluralization rule lives in the projector, so test both branches.
    // This is the contract the workspace card's footer slot relies on
    // (see `canvas-theme.ts` → `renderMetricsFooter`).
    mockBlob(null);
    mockWorkspaces([
      { id: "w1", name: "Alpha", repositoryCount: 1 },
      { id: "w2", name: "Beta", repositoryCount: 3 },
      { id: "w3", name: "Gamma", repositoryCount: 0 },
    ]);

    const { nodes } = await read("org-1", "");
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId["ws:w1"].customData?.secondary).toBe("1 repo");
    expect(byId["ws:w2"].customData?.secondary).toBe("3 repos");
    expect(byId["ws:w3"].customData?.secondary).toBe("0 repos");
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

describe("readCanvas (child-canvas rollup)", () => {
  it("stamps child-canvas progress into a parent objective's customData", async () => {
    // Parent canvas: one authored objective with a drillable ref.
    mockBlob({
      nodes: [
        {
          id: "obj-1",
          type: "text",
          x: 10,
          y: 10,
          text: "Ship mobile",
          category: "objective",
          ref: "node:obj-1",
        },
      ],
      edges: [],
    });
    mockWorkspaces([]); // rootProjector no-op for simplicity

    // Child canvas: 2 of 4 mini-objectives are done.
    dbMock.canvas.findMany.mockResolvedValue([
      {
        ref: "node:obj-1",
        data: {
          nodes: [
            {
              id: "c1",
              type: "text",
              x: 0,
              y: 0,
              text: "a",
              category: "objective",
              customData: { status: "ok" },
            },
            {
              id: "c2",
              type: "text",
              x: 0,
              y: 0,
              text: "b",
              category: "objective",
              customData: { status: "ok" },
            },
            {
              id: "c3",
              type: "text",
              x: 0,
              y: 0,
              text: "c",
              category: "objective",
              customData: { status: "attn" },
            },
            {
              id: "c4",
              type: "text",
              x: 0,
              y: 0,
              text: "d",
              category: "objective",
            },
          ],
          edges: [],
        },
      },
    ]);

    const { nodes } = await read("org-1", "");
    const obj = nodes.find((n) => n.id === "obj-1");
    expect(obj?.customData).toMatchObject({
      primary: "50%",
      secondary: "2/4",
      status: "attn",
    });
  });

  it("does NOT overwrite a manual status the user has set (manual wins)", async () => {
    mockBlob({
      nodes: [
        {
          id: "obj-1",
          type: "text",
          x: 0,
          y: 0,
          text: "Ship mobile",
          category: "objective",
          ref: "node:obj-1",
          // User marked this at-risk manually.
          customData: { status: "risk" },
        },
      ],
      edges: [],
    });
    mockWorkspaces([]);
    dbMock.canvas.findMany.mockResolvedValue([
      {
        ref: "node:obj-1",
        data: {
          nodes: [
            {
              id: "c1",
              type: "text",
              x: 0,
              y: 0,
              text: "a",
              category: "objective",
              customData: { status: "ok" },
            },
          ],
          edges: [],
        },
      },
    ]);

    const { nodes } = await read("org-1", "");
    const obj = nodes.find((n) => n.id === "obj-1");
    // Manual status stays; rollup still fills in primary/secondary.
    expect(obj?.customData?.status).toBe("risk");
    expect(obj?.customData?.primary).toBe("100%");
    expect(obj?.customData?.secondary).toBe("1/1");
  });
});

describe("readCanvas (workspace scope)", () => {
  function mockRepositories(repos: Array<{ id: string; name: string }>) {
    dbMock.repository.findMany.mockResolvedValue(repos);
  }

  function mockOwnedWorkspace(id: string | null) {
    // The workspace projector guards with `findFirst({ id, orgId })` to
    // prevent cross-org reads; tests decide whether that guard passes.
    dbMock.workspace.findFirst.mockResolvedValue(id ? { id } : null);
  }

  it("projects repositories as repo:<id> live nodes on a workspace sub-canvas", async () => {
    mockBlob(null);
    mockWorkspaces([]); // rootProjector is a no-op here, but it still runs
    mockOwnedWorkspace("w1");
    mockRepositories([
      { id: "r1", name: "hive" },
      { id: "r2", name: "stack" },
    ]);

    const { nodes } = await read("org-1", "ws:w1");
    expect(nodes.map((n) => n.id)).toEqual(["repo:r1", "repo:r2"]);
    expect(nodes[0].text).toBe("hive");
    expect(nodes[0].category).toBe("repository");
  });

  it("returns no projected nodes when the workspace is not owned by this org", async () => {
    // Guard against cross-org reads: scope.workspaceId must belong to
    // orgId, otherwise the projector emits nothing (even if the
    // workspace exists in some other org's canvas).
    mockBlob(null);
    mockWorkspaces([]);
    mockOwnedWorkspace(null);
    // `findMany` should not be called when the guard fails, but mock it
    // anyway so a regression (dropping the guard) would surface as the
    // test seeing unexpected repo nodes.
    mockRepositories([{ id: "leaked", name: "should-not-appear" }]);

    const { nodes } = await read("other-org", "ws:w1");
    expect(nodes).toEqual([]);
  });

  it("applies stored positions on top of default repo placement", async () => {
    mockBlob({
      nodes: [],
      edges: [],
      positions: { "repo:r1": { x: 500, y: 200 } },
    });
    mockWorkspaces([]);
    mockOwnedWorkspace("w1");
    mockRepositories([{ id: "r1", name: "hive" }]);

    const { nodes } = await read("org-1", "ws:w1");
    const r1 = nodes.find((n) => n.id === "repo:r1");
    expect(r1?.x).toBe(500);
    expect(r1?.y).toBe(200);
  });

  it("root-scope reads do NOT project repositories", async () => {
    // The workspace projector must gate on `scope.kind === "workspace"`;
    // a leak here would cause repos to appear on the org root canvas.
    mockBlob(null);
    mockWorkspaces([{ id: "w1", name: "Alpha" }]);
    mockOwnedWorkspace("w1");
    mockRepositories([{ id: "r1", name: "hive" }]);

    const { nodes } = await read("org-1", "");
    expect(nodes.map((n) => n.id)).toEqual(["ws:w1"]);
    expect(dbMock.repository.findMany).not.toHaveBeenCalled();
  });
});
