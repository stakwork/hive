import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit-test the merge half of the projection pipeline against a mocked
 * Prisma client. Covers:
 *   - workspace + initiative projection on root
 *   - milestone projection on an initiative timeline sub-canvas
 *   - repository projection on a workspace sub-canvas
 *   - shared invariants: positions overlay, hidden filter, dangling
 *     edges, authored-after-live ordering
 *
 * The pre-cutover "child-canvas rollup" pipeline (rollups.ts) is gone;
 * tests that exercised it have been removed. Initiative progress is
 * now derived in-projector from real DB milestone counts.
 */

vi.mock("@/lib/db", () => ({
  db: {
    canvas: { findUnique: vi.fn(), findMany: vi.fn() },
    workspace: { findMany: vi.fn(), findFirst: vi.fn() },
    repository: { findMany: vi.fn() },
    initiative: { findMany: vi.fn(), findFirst: vi.fn() },
    milestone: { findMany: vi.fn() },
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
  initiative: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  milestone: { findMany: ReturnType<typeof vi.fn> };
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
 * drives the "N repos" footer.
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

/**
 * Mock the initiative projector's `findMany` shape: each row carries
 * its milestones as `{ status }[]` so the projector can count
 * COMPLETED ones for the rollup. Tests pass a flat status array per
 * initiative; we shape it for Prisma here.
 */
function mockInitiatives(
  inits: Array<{ id: string; name: string; milestoneStatuses?: string[] }>,
) {
  dbMock.initiative.findMany.mockResolvedValue(
    inits.map((i) => ({
      id: i.id,
      name: i.name,
      milestones: (i.milestoneStatuses ?? []).map((status) => ({ status })),
    })),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default: empty projections so any projector that runs without a
  // test-specific mock gets `[]` instead of throwing.
  dbMock.canvas.findMany.mockResolvedValue([]);
  dbMock.workspace.findMany.mockResolvedValue([]);
  dbMock.initiative.findMany.mockResolvedValue([]);
  dbMock.milestone.findMany.mockResolvedValue([]);
});

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
    const wsNodes = nodes.filter((n) => n.id.startsWith("ws:"));
    expect(wsNodes.map((n) => n.id)).toEqual(["ws:w1", "ws:w2"]);
    // Projected nodes carry `ref: "ws:<id>"` so clicking drills in.
    expect(wsNodes.every((n) => n.ref?.startsWith("ws:"))).toBe(true);
    expect(wsNodes[0].text).toBe("Alpha");
  });

  it("stamps a pluralized 'N repo(s)' footer into workspace customData", async () => {
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
          id: "note-1",
          type: "text",
          x: 10,
          y: 300,
          text: "Heads up...",
          category: "note",
        },
      ],
      edges: [],
    });
    mockWorkspaces([{ id: "w1", name: "Alpha" }]);

    const { nodes } = await read("org-1", "");
    expect(nodes.map((n) => n.id)).toEqual(["ws:w1", "note-1"]);
  });

  it("filters out edges whose endpoints don't exist after projection", async () => {
    mockBlob({
      nodes: [
        {
          id: "note-1",
          type: "text",
          x: 0,
          y: 0,
          text: "x",
          category: "note",
        },
      ],
      edges: [
        { id: "e-ok", fromNode: "note-1", toNode: "ws:w1" },
        { id: "e-dangling", fromNode: "note-1", toNode: "ws:gone" },
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
          id: "note-1",
          type: "text",
          x: 0,
          y: 0,
          text: "x",
          category: "note",
        },
      ],
      edges: [{ id: "e1", fromNode: "note-1", toNode: "ws:w1" }],
      hidden: ["ws:w1"],
    });
    mockWorkspaces([{ id: "w1", name: "Alpha" }]);

    const { nodes, edges } = await read("org-1", "");
    expect(nodes.map((n) => n.id)).toEqual(["note-1"]);
    expect(edges).toEqual([]);
  });
});

describe("readCanvas (initiative projection on root)", () => {
  it("projects initiatives as initiative:<id> live nodes alongside workspaces", async () => {
    mockBlob(null);
    mockWorkspaces([{ id: "w1", name: "Alpha" }]);
    mockInitiatives([
      { id: "i1", name: "Mobile launch" },
      { id: "i2", name: "SOC2" },
    ]);

    const { nodes } = await read("org-1", "");
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain("ws:w1");
    expect(ids).toContain("initiative:i1");
    expect(ids).toContain("initiative:i2");
    // Each initiative node carries a `ref` for drill-in to its timeline.
    const i1 = nodes.find((n) => n.id === "initiative:i1");
    expect(i1?.ref).toBe("initiative:i1");
    expect(i1?.text).toBe("Mobile launch");
    expect(i1?.category).toBe("initiative");
  });

  it("computes milestone-completion progress into customData", async () => {
    mockBlob(null);
    mockInitiatives([
      // 2 of 4 milestones COMPLETED → 50%
      {
        id: "i1",
        name: "Mobile launch",
        milestoneStatuses: ["COMPLETED", "COMPLETED", "IN_PROGRESS", "NOT_STARTED"],
      },
      // No milestones yet — secondary should explain that, no `primary`.
      { id: "i2", name: "Empty", milestoneStatuses: [] },
      // All done → 100%
      { id: "i3", name: "Done", milestoneStatuses: ["COMPLETED", "COMPLETED"] },
    ]);

    const { nodes } = await read("org-1", "");
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId["initiative:i1"].customData).toEqual({
      primary: "50%",
      secondary: "2/4 milestones",
    });
    expect(byId["initiative:i2"].customData).toEqual({
      secondary: "no milestones yet",
    });
    expect(byId["initiative:i3"].customData).toEqual({
      primary: "100%",
      secondary: "2/2 milestones",
    });
  });

  it("does NOT carry an Initiative.status pill on the canvas (intentional)", async () => {
    // Initiatives can be long-running; a status traffic-light would
    // mislead. The projector emits no `customData.status` regardless of
    // what's in the DB row.
    mockBlob(null);
    mockInitiatives([{ id: "i1", name: "Forever", milestoneStatuses: [] }]);

    const { nodes } = await read("org-1", "");
    const i1 = nodes.find((n) => n.id === "initiative:i1");
    expect(i1?.customData?.status).toBeUndefined();
  });

  it("singularizes the milestone count for exactly one milestone", async () => {
    mockBlob(null);
    mockInitiatives([
      { id: "i1", name: "Solo", milestoneStatuses: ["COMPLETED"] },
    ]);

    const { nodes } = await read("org-1", "");
    expect(
      nodes.find((n) => n.id === "initiative:i1")?.customData?.secondary,
    ).toBe("1/1 milestone");
  });
});

describe("readCanvas (initiative scope — milestone timeline)", () => {
  function mockOwnedInitiative(id: string | null) {
    dbMock.initiative.findFirst.mockResolvedValue(id ? { id } : null);
  }

  function mockMilestones(
    list: Array<{
      id: string;
      name: string;
      status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
      sequence: number;
      dueDate?: Date | null;
      featureCount?: number;
    }>,
  ) {
    dbMock.milestone.findMany.mockResolvedValue(
      list.map((m) => ({
        ...m,
        dueDate: m.dueDate ?? null,
        _count: { features: m.featureCount ?? 0 },
      })),
    );
  }

  it("projects milestones as milestone:<id> nodes ordered by sequence", async () => {
    mockBlob(null);
    mockOwnedInitiative("i1");
    mockMilestones([
      { id: "m1", name: "Beta", status: "IN_PROGRESS", sequence: 1 },
      { id: "m2", name: "GA", status: "NOT_STARTED", sequence: 2 },
    ]);

    const { nodes } = await read("org-1", "initiative:i1");
    expect(nodes.map((n) => n.id)).toEqual(["milestone:m1", "milestone:m2"]);
    expect(nodes[0].text).toBe("Beta");
    expect(nodes[0].category).toBe("milestone");
    // Status is passed through verbatim so the theme can map it.
    expect(nodes[0].customData?.status).toBe("IN_PROGRESS");
    expect(nodes[1].customData?.status).toBe("NOT_STARTED");
  });

  it("includes due date and feature count in the footer when present", async () => {
    mockBlob(null);
    mockOwnedInitiative("i1");
    mockMilestones([
      {
        id: "m1",
        name: "Alpha",
        status: "IN_PROGRESS",
        sequence: 1,
        dueDate: new Date("2026-03-04T00:00:00Z"),
        featureCount: 2,
      },
      // No due date and no features → no `secondary` key.
      { id: "m2", name: "Bare", status: "NOT_STARTED", sequence: 2 },
    ]);

    const { nodes } = await read("org-1", "initiative:i1");
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    // The exact date string depends on the locale of the host running
    // tests; assert a stable substring that doesn't depend on TZ.
    expect(byId["milestone:m1"].customData?.secondary).toMatch(/Due /);
    expect(byId["milestone:m1"].customData?.secondary).toMatch(/2 features/);
    expect(byId["milestone:m2"].customData?.secondary).toBeUndefined();
  });

  it("returns no projected nodes when the initiative isn't owned by this org", async () => {
    // Org-ownership guard. The projector calls findFirst with `orgId`
    // in the where clause; if that returns null, no milestones leak.
    mockBlob(null);
    mockOwnedInitiative(null);
    // Mock milestones anyway — a regression that drops the guard would
    // surface as the test seeing them.
    mockMilestones([
      { id: "leaked", name: "x", status: "NOT_STARTED", sequence: 1 },
    ]);

    const { nodes } = await read("other-org", "initiative:i1");
    expect(nodes).toEqual([]);
    // findMany should not have been called when the guard fails.
    expect(dbMock.milestone.findMany).not.toHaveBeenCalled();
  });

  it("applies stored positions on top of default timeline placement", async () => {
    mockBlob({
      nodes: [],
      edges: [],
      positions: { "milestone:m1": { x: 1234, y: 567 } },
    });
    mockOwnedInitiative("i1");
    mockMilestones([
      { id: "m1", name: "Alpha", status: "IN_PROGRESS", sequence: 1 },
    ]);

    const { nodes } = await read("org-1", "initiative:i1");
    const m1 = nodes.find((n) => n.id === "milestone:m1");
    expect(m1?.x).toBe(1234);
    expect(m1?.y).toBe(567);
  });

  it("emits four timeline columns (Past Due / This Quarter / Next Quarter / Later)", async () => {
    // Columns are decorative chrome rendered behind milestone cards.
    // We assert the four column ids are stable; their labels include
    // a calendar-quarter suffix that varies by run date, so we don't
    // pin the exact label text.
    mockBlob(null);
    mockOwnedInitiative("i1");
    mockMilestones([]);

    const data = await readCanvas("org-1", "initiative:i1");
    expect(data.columns?.map((c) => c.id)).toEqual([
      "past-due",
      "this-quarter",
      "next-quarter",
      "later",
    ]);
    // Column labels surface the quarter suffix only on the middle two.
    expect(data.columns?.[0].label).toBe("Past Due");
    expect(data.columns?.[1].label).toMatch(/^This Quarter · Q[1-4] \d{4}$/);
    expect(data.columns?.[2].label).toMatch(/^Next Quarter · Q[1-4] \d{4}$/);
    expect(data.columns?.[3].label).toBe("Later");
    // Columns are evenly sized and laid out left-to-right.
    const widths = data.columns?.map((c) => c.size) ?? [];
    expect(new Set(widths).size).toBe(1);
    const starts = data.columns?.map((c) => c.start) ?? [];
    expect(starts).toEqual(
      [...starts].sort((a, b) => a - b),
    );
  });

  it("does NOT emit timeline columns on the root canvas", async () => {
    mockBlob(null);
    mockWorkspaces([{ id: "w1", name: "Alpha" }]);

    const data = await readCanvas("org-1", "");
    expect(data.columns).toBeUndefined();
  });
});

describe("buildTimelineColumns (quarter math)", () => {
  // Imported lazily so the projector module's side-effect-free helper
  // is exercised directly without relying on `new Date()` inside the
  // projector's `project` call.
  it("computes 'next quarter' across a year boundary", async () => {
    const { buildTimelineColumns } = await import(
      "@/lib/canvas/projectors"
    );
    // 2026-12-15 is in Q4 (quarter index 3); next quarter wraps to
    // Q1 2027.
    const cols = buildTimelineColumns(new Date("2026-12-15T12:00:00Z"));
    expect(cols.find((c) => c.id === "this-quarter")?.label).toBe(
      "This Quarter · Q4 2026",
    );
    expect(cols.find((c) => c.id === "next-quarter")?.label).toBe(
      "Next Quarter · Q1 2027",
    );
  });

  it("uses calendar quarters (Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec)", async () => {
    const { buildTimelineColumns } = await import(
      "@/lib/canvas/projectors"
    );
    // 2026-04-01: first day of Q2.
    const cols = buildTimelineColumns(new Date("2026-04-01T12:00:00Z"));
    expect(cols.find((c) => c.id === "this-quarter")?.label).toContain(
      "Q2 2026",
    );
    expect(cols.find((c) => c.id === "next-quarter")?.label).toContain(
      "Q3 2026",
    );
  });
});

describe("readCanvas (workspace scope)", () => {
  function mockRepositories(repos: Array<{ id: string; name: string }>) {
    dbMock.repository.findMany.mockResolvedValue(repos);
  }

  function mockOwnedWorkspace(id: string | null) {
    dbMock.workspace.findFirst.mockResolvedValue(id ? { id } : null);
  }

  it("projects repositories as repo:<id> live nodes on a workspace sub-canvas", async () => {
    mockBlob(null);
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
    mockBlob(null);
    mockOwnedWorkspace(null);
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
    mockOwnedWorkspace("w1");
    mockRepositories([{ id: "r1", name: "hive" }]);

    const { nodes } = await read("org-1", "ws:w1");
    const r1 = nodes.find((n) => n.id === "repo:r1");
    expect(r1?.x).toBe(500);
    expect(r1?.y).toBe(200);
  });

  it("root-scope reads do NOT project repositories", async () => {
    mockBlob(null);
    mockWorkspaces([{ id: "w1", name: "Alpha" }]);
    mockOwnedWorkspace("w1");
    mockRepositories([{ id: "r1", name: "hive" }]);

    const { nodes } = await read("org-1", "");
    expect(nodes.map((n) => n.id)).toEqual(["ws:w1"]);
    expect(dbMock.repository.findMany).not.toHaveBeenCalled();
  });

  it("workspace-scope reads do NOT project initiatives or milestones", async () => {
    // Each projector must gate on `scope.kind`. A leak here would
    // sprinkle initiative cards onto a workspace sub-canvas.
    mockBlob(null);
    mockOwnedWorkspace("w1");
    mockRepositories([{ id: "r1", name: "hive" }]);
    mockInitiatives([{ id: "i1", name: "Should not appear" }]);

    const { nodes } = await read("org-1", "ws:w1");
    expect(nodes.map((n) => n.id)).toEqual(["repo:r1"]);
    expect(dbMock.initiative.findMany).not.toHaveBeenCalled();
    expect(dbMock.milestone.findMany).not.toHaveBeenCalled();
  });
});
