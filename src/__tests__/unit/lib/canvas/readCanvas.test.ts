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
    // `update` is used by the workspaceProjector's lazy stale-pin
    // cleanup (fire-and-forget). The mock returns a resolved promise
    // so the awaited path inside the cleanup doesn't reject; tests
    // don't assert on the call, but the projector must not crash
    // when invoked.
    canvas: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    workspace: { findMany: vi.fn(), findFirst: vi.fn() },
    repository: { findMany: vi.fn() },
    initiative: { findMany: vi.fn(), findFirst: vi.fn() },
    // The milestone-timeline projector uses findMany. The new
    // milestone sub-canvas projector uses findFirst (the
    // org-ownership guard).
    milestone: { findMany: vi.fn(), findFirst: vi.fn() },
    // The milestone sub-canvas projector pulls features (with their
    // tasks) for the milestone-scope read path. The workspaceProjector
    // ALSO pulls features for the assigned-features (pin) path.
    feature: { findMany: vi.fn() },
    // The research projector pulls rows on root and initiative scopes.
    research: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { readCanvas } from "@/lib/canvas";
import type { CanvasBlob } from "@/lib/canvas";

const dbMock = db as unknown as {
  canvas: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
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
  milestone: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  feature: { findMany: ReturnType<typeof vi.fn> };
  research: { findMany: ReturnType<typeof vi.fn> };
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
  // test-specific mock gets `[]` instead of throwing. Each `findMany`
  // is run unconditionally for its scope by `readCanvas`, so they
  // must all resolve to *something*.
  dbMock.canvas.findMany.mockResolvedValue([]);
  dbMock.workspace.findMany.mockResolvedValue([]);
  dbMock.initiative.findMany.mockResolvedValue([]);
  dbMock.milestone.findMany.mockResolvedValue([]);
  dbMock.feature.findMany.mockResolvedValue([]);
  dbMock.research.findMany.mockResolvedValue([]);
  // `findFirst` calls in projectors are scope-gated; default to null
  // (no-such-record) so unintended calls fail fast and surface as a
  // test bug rather than a silent leak.
  dbMock.milestone.findFirst.mockResolvedValue(null);
  dbMock.initiative.findFirst.mockResolvedValue(null);
  dbMock.workspace.findFirst.mockResolvedValue(null);
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

  /**
   * Mock the milestone projector's Prisma read. The projector pulls
   * each linked feature's `status` (for progress) plus a per-feature
   * `_count.tasks` filtered to PENDING+IN_PROGRESS workflow status
   * (for the "agent active" badge).
   *
   * Tests can specify either:
   *   - `featureStatuses` — explicit list of feature statuses
   *   - `featureCount` — denominator only; statuses default to BACKLOG
   *
   * For agent-count testing, pass `featureAgentCounts` aligned 1:1 with
   * `featureStatuses` (or `featureCount`). Defaults to zero per
   * feature when omitted.
   */
  /**
   * Compact team-member shape used in milestone mocks. Matches the
   * minimal Prisma `select` the projector emits for `assignee` /
   * `createdBy` (id + name + image).
   */
  type MockUser = { id: string; name: string | null; image?: string | null };

  function mockMilestones(
    list: Array<{
      id: string;
      name: string;
      status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
      sequence: number;
      dueDate?: Date | null;
      featureCount?: number;
      featureStatuses?: string[];
      featureAgentCounts?: number[];
      // Per-feature assignee / createdBy. Aligned 1:1 with featureStatuses
      // (or featureCount). Default is null both → no team members for
      // tests that don't care about avatars.
      featureAssignees?: Array<MockUser | null>;
      featureCreators?: Array<MockUser | null>;
    }>,
  ) {
    dbMock.milestone.findMany.mockResolvedValue(
      list.map((m) => {
        const statuses =
          m.featureStatuses ??
          Array.from({ length: m.featureCount ?? 0 }, () => "BACKLOG");
        const agentCounts = m.featureAgentCounts ?? [];
        const assignees = m.featureAssignees ?? [];
        const creators = m.featureCreators ?? [];
        return {
          ...m,
          dueDate: m.dueDate ?? null,
          features: statuses.map((status, i) => ({
            id: `${m.id}-f${i}`,
            status,
            _count: { tasks: agentCounts[i] ?? 0 },
            assignee: assignees[i] ?? null,
            createdBy: creators[i] ?? null,
          })),
        };
      }),
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

  it("includes due date and a done/total feature counter in the footer when present", async () => {
    mockBlob(null);
    mockOwnedInitiative("i1");
    mockMilestones([
      {
        id: "m1",
        name: "Alpha",
        status: "IN_PROGRESS",
        sequence: 1,
        dueDate: new Date("2026-03-04T00:00:00Z"),
        // 1 of 2 features done → "1/2 features" in the footer.
        featureStatuses: ["COMPLETED", "IN_PROGRESS"],
      },
      // No due date and no features → no `secondary` key.
      { id: "m2", name: "Bare", status: "NOT_STARTED", sequence: 2 },
    ]);

    const { nodes } = await read("org-1", "initiative:i1");
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    // The exact date string depends on the locale of the host running
    // tests; assert a stable substring that doesn't depend on TZ.
    expect(byId["milestone:m1"].customData?.secondary).toMatch(/Due /);
    expect(byId["milestone:m1"].customData?.secondary).toMatch(/1\/2 features/);
    expect(byId["milestone:m2"].customData?.secondary).toBeUndefined();
  });

  it("emits a 0..1 progress fraction and feature counters in customData", async () => {
    // The bodyTop progress slot consumes `customData.progress`
    // (NodeAccessor<number> in 0..1) and gates display on
    // `customData.featureCount`. Pin the projector contract so the
    // theme code can rely on these fields existing.
    mockBlob(null);
    mockOwnedInitiative("i1");
    mockMilestones([
      // 2 of 4 done → 50%
      {
        id: "m-half",
        name: "Half",
        status: "IN_PROGRESS",
        sequence: 1,
        featureStatuses: ["COMPLETED", "COMPLETED", "IN_PROGRESS", "BACKLOG"],
      },
      // 0 of 0 → progress=0, featureCount=0 (theme hides bar)
      { id: "m-empty", name: "Empty", status: "NOT_STARTED", sequence: 2 },
      // 3 of 3 → 100%
      {
        id: "m-full",
        name: "Full",
        status: "COMPLETED",
        sequence: 3,
        featureStatuses: ["COMPLETED", "COMPLETED", "COMPLETED"],
      },
    ]);

    const { nodes } = await read("org-1", "initiative:i1");
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

    expect(byId["milestone:m-half"].customData?.progress).toBe(0.5);
    expect(byId["milestone:m-half"].customData?.featureCount).toBe(4);
    expect(byId["milestone:m-half"].customData?.featureDone).toBe(2);

    expect(byId["milestone:m-empty"].customData?.progress).toBe(0);
    expect(byId["milestone:m-empty"].customData?.featureCount).toBe(0);
    expect(byId["milestone:m-empty"].customData?.featureDone).toBe(0);

    expect(byId["milestone:m-full"].customData?.progress).toBe(1);
    expect(byId["milestone:m-full"].customData?.featureCount).toBe(3);
    expect(byId["milestone:m-full"].customData?.featureDone).toBe(3);
  });

  it("sums per-feature agent-in-flight task counts into customData.agentCount", async () => {
    // The topRightOuter count badge consumes `customData.agentCount`.
    // It's the SUM across linked features of tasks where workflowStatus
    // ∈ {PENDING, IN_PROGRESS} — the kanban definition of "in flight."
    // The Prisma `_count.tasks` filter happens at query time; the
    // projector just sums the per-feature counts.
    mockBlob(null);
    mockOwnedInitiative("i1");
    mockMilestones([
      {
        id: "m-busy",
        name: "Busy",
        status: "IN_PROGRESS",
        sequence: 1,
        featureStatuses: ["IN_PROGRESS", "BACKLOG", "IN_PROGRESS"],
        featureAgentCounts: [2, 0, 1], // sum = 3
      },
      // Linked features but no agents running anywhere → 0 (badge hidden).
      {
        id: "m-quiet",
        name: "Quiet",
        status: "NOT_STARTED",
        sequence: 2,
        featureStatuses: ["BACKLOG", "PLANNED"],
        featureAgentCounts: [0, 0],
      },
      // No features at all → 0.
      { id: "m-empty", name: "Empty", status: "NOT_STARTED", sequence: 3 },
    ]);

    const { nodes } = await read("org-1", "initiative:i1");
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

    expect(byId["milestone:m-busy"].customData?.agentCount).toBe(3);
    expect(byId["milestone:m-quiet"].customData?.agentCount).toBe(0);
    expect(byId["milestone:m-empty"].customData?.agentCount).toBe(0);
  });

  it("unions feature.assignee + feature.createdBy across linked features into customData.team", async () => {
    // Team stack contract: distinct user ids only; visible portion
    // capped at 3 with the remainder surfaced as `teamOverflow`.
    mockBlob(null);
    mockOwnedInitiative("i1");
    mockMilestones([
      {
        id: "m-team",
        name: "Big team",
        status: "IN_PROGRESS",
        sequence: 1,
        featureStatuses: ["BACKLOG", "BACKLOG", "BACKLOG", "BACKLOG"],
        // Five DISTINCT users involved across four features:
        //   f0: assignee=alice, createdBy=bob
        //   f1: assignee=alice, createdBy=carol   (alice dedup'd)
        //   f2: assignee=null,  createdBy=dave
        //   f3: assignee=eve,   createdBy=alice   (alice dedup'd again)
        // Five total; three visible; overflow=2.
        featureAssignees: [
          { id: "u-alice", name: "Alice", image: null },
          { id: "u-alice", name: "Alice", image: null },
          null,
          { id: "u-eve", name: "Eve", image: null },
        ],
        featureCreators: [
          { id: "u-bob", name: "Bob", image: null },
          { id: "u-carol", name: "Carol", image: null },
          { id: "u-dave", name: "Dave", image: null },
          { id: "u-alice", name: "Alice", image: null },
        ],
      },
      // No assignees/creators → empty team, zero overflow.
      {
        id: "m-solo",
        name: "Solo",
        status: "NOT_STARTED",
        sequence: 2,
      },
    ]);

    const { nodes } = await read("org-1", "initiative:i1");
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

    const team = byId["milestone:m-team"].customData?.team as Array<{ id: string }>;
    expect(team).toHaveLength(3); // visible cap
    expect(byId["milestone:m-team"].customData?.teamOverflow).toBe(2); // 5 - 3
    // Alice is in there exactly once (deduplicated across features).
    expect(team.filter((u) => u.id === "u-alice")).toHaveLength(1);

    expect(byId["milestone:m-solo"].customData?.team).toEqual([]);
    expect(byId["milestone:m-solo"].customData?.teamOverflow).toBe(0);
  });

  it("milestone nodes do NOT carry a ref — they're leaf cards on the initiative canvas, not drillable", async () => {
    // Milestones render alongside their linked features on the
    // initiative canvas; membership is shown via projector-emitted
    // synthetic edges (see the next describe block). There is no
    // milestone sub-canvas to drill into, so the card must NOT
    // advertise a ref.
    mockBlob(null);
    mockOwnedInitiative("i1");
    mockMilestones([
      { id: "m-x", name: "Beta", status: "IN_PROGRESS", sequence: 1 },
    ]);

    const { nodes } = await read("org-1", "initiative:i1");
    const m = nodes.find((n) => n.id === "milestone:m-x");
    expect(m?.ref).toBeUndefined();
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

  // ─── Assigned-features overlay (workspace canvas feature pins) ──────────
  //
  // The workspace projector emits one `feature:<id>` card per id in
  // `CanvasBlob.assignedFeatures`, validated to belong to this
  // workspace + non-deleted. Cross-workspace ids and soft-deleted
  // features are silently filtered out (and lazy-cleaned from the
  // persisted list — but the cleanup itself is fire-and-forget and
  // not asserted here).

  /** Mock the `db.feature.findMany` the assigned-features path calls. */
  function mockAssignedFeatures(
    features: Array<{
      id: string;
      title: string;
      status?: string;
      workflowStatus?: string | null;
    }>,
  ) {
    dbMock.feature.findMany.mockResolvedValue(
      features.map((f) => ({
        id: f.id,
        title: f.title,
        status: f.status ?? "BACKLOG",
        workflowStatus: f.workflowStatus ?? null,
        tasks: [],
      })),
    );
  }

  it("emits feature cards for pinned ids in user-pinned order", async () => {
    mockBlob({
      nodes: [],
      edges: [],
      assignedFeatures: ["feat_b", "feat_a"], // intentional reverse order
    });
    mockOwnedWorkspace("w1");
    mockRepositories([]);
    mockAssignedFeatures([
      { id: "feat_a", title: "Auth" },
      { id: "feat_b", title: "Billing" },
    ]);

    const { nodes } = await read("org-1", "ws:w1");
    // Pinned order wins, not DB order.
    expect(nodes.map((n) => n.id)).toEqual(["feature:feat_b", "feature:feat_a"]);
    expect(nodes[0].category).toBe("feature");
    expect(nodes[0].text).toBe("Billing");
  });

  it("silently drops orphan pin ids that don't resolve (deleted/moved features)", async () => {
    mockBlob({
      nodes: [],
      edges: [],
      assignedFeatures: ["feat_alive", "feat_deleted", "feat_moved_away"],
    });
    mockOwnedWorkspace("w1");
    mockRepositories([]);
    // Only `feat_alive` comes back from the DB — the projector
    // queries with `workspaceId: w1, deleted: false`, so soft-
    // deleted and cross-workspace features are absent from the
    // result set.
    mockAssignedFeatures([{ id: "feat_alive", title: "Live" }]);

    const { nodes } = await read("org-1", "ws:w1");
    // Only the surviving feature renders. No phantom card for the
    // orphan ids.
    expect(nodes.map((n) => n.id)).toEqual(["feature:feat_alive"]);
  });

  it("does not call db.feature.findMany when the pin list is empty", async () => {
    mockBlob({ nodes: [], edges: [] });
    mockOwnedWorkspace("w1");
    mockRepositories([{ id: "r1", name: "hive" }]);

    const { nodes } = await read("org-1", "ws:w1");
    expect(nodes.map((n) => n.id)).toEqual(["repo:r1"]);
    expect(dbMock.feature.findMany).not.toHaveBeenCalled();
  });

  it("applies stored positions to pinned feature cards", async () => {
    mockBlob({
      nodes: [],
      edges: [],
      assignedFeatures: ["feat_a"],
      positions: { "feature:feat_a": { x: 700, y: 400 } },
    });
    mockOwnedWorkspace("w1");
    mockRepositories([]);
    mockAssignedFeatures([{ id: "feat_a", title: "Auth" }]);

    const { nodes } = await read("org-1", "ws:w1");
    const fa = nodes.find((n) => n.id === "feature:feat_a");
    expect(fa?.x).toBe(700);
    expect(fa?.y).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Initiative canvas — feature cards + synthetic membership edges
//
// Every feature anchored to the initiative (with or without a
// milestone) renders as a sibling card alongside the milestone cards
// on the initiative canvas. Milestone membership is shown by a
// projector-emitted synthetic edge — `feature:<id> → milestone:<id>`
// — that round-trips on every read but is filtered out of the blob
// on save (DB membership is the source of truth).
//
// Opaque `milestone:<id>` refs (legacy deep links) project nothing.
// ---------------------------------------------------------------------------

describe("readCanvas (initiative scope — feature cards + synthetic edges)", () => {
  function mockOwnedInitiative(id: string | null) {
    dbMock.initiative.findFirst.mockResolvedValue(id ? { id } : null);
  }

  /**
   * Mock the initiative-canvas feature pull. Each entry is a Feature
   * with its `milestoneId` (null for initiative-loose features) and
   * its (already-filtered) tasks.
   */
  function mockInitiativeFeatures(
    list: Array<{
      id: string;
      title: string;
      status?: string;
      workflowStatus?: string | null;
      milestoneId?: string | null;
      tasks?: Array<{ status: string }>;
    }>,
  ) {
    dbMock.feature.findMany.mockResolvedValue(
      list.map((f) => ({
        id: f.id,
        title: f.title,
        status: f.status ?? "BACKLOG",
        workflowStatus: f.workflowStatus ?? null,
        milestoneId: f.milestoneId ?? null,
        tasks: f.tasks ?? [],
      })),
    );
  }

  it("projects every initiative-anchored feature alongside the milestone cards", async () => {
    mockBlob(null);
    mockOwnedInitiative("i1");
    dbMock.milestone.findMany.mockResolvedValue([
      {
        id: "m1",
        name: "Beta",
        status: "IN_PROGRESS",
        sequence: 1,
        dueDate: null,
        features: [],
      },
    ]);
    mockInitiativeFeatures([
      { id: "f-loose", title: "Loose feature" },
      { id: "f-bound", title: "Bound feature", milestoneId: "m1" },
    ]);

    const { nodes } = await read("org-1", "initiative:i1");
    const featureIds = nodes
      .filter((n) => n.id.startsWith("feature:"))
      .map((n) => n.id);
    expect(featureIds).toEqual(["feature:f-loose", "feature:f-bound"]);
    // Milestone card still projects too.
    expect(nodes.some((n) => n.id === "milestone:m1")).toBe(true);
  });

  it("emits a synthetic feature→milestone edge for each milestone-bound feature", async () => {
    mockBlob(null);
    mockOwnedInitiative("i1");
    dbMock.milestone.findMany.mockResolvedValue([
      {
        id: "m1",
        name: "Beta",
        status: "IN_PROGRESS",
        sequence: 1,
        dueDate: null,
        features: [],
      },
    ]);
    mockInitiativeFeatures([
      { id: "f-bound", title: "Bound", milestoneId: "m1" },
      { id: "f-loose", title: "Loose" }, // no edge
    ]);

    const { edges } = await read("org-1", "initiative:i1");
    const synthetic = edges.filter((e) => e.id.startsWith("synthetic:"));
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]).toMatchObject({
      id: "synthetic:feature-milestone:f-bound",
      fromNode: "feature:f-bound",
      toNode: "milestone:m1",
    });
  });

  it("drops synthetic edges whose milestone endpoint was hidden", async () => {
    // Referential integrity: edges (synthetic or authored) with a
    // missing endpoint get pruned in `readCanvas`. Hiding a milestone
    // card on this canvas should also drop its membership edges.
    mockBlob({ nodes: [], edges: [], hidden: ["milestone:m1"] });
    mockOwnedInitiative("i1");
    dbMock.milestone.findMany.mockResolvedValue([
      {
        id: "m1",
        name: "Beta",
        status: "IN_PROGRESS",
        sequence: 1,
        dueDate: null,
        features: [],
      },
    ]);
    mockInitiativeFeatures([
      { id: "f-bound", title: "Bound", milestoneId: "m1" },
    ]);

    const { nodes, edges } = await read("org-1", "initiative:i1");
    expect(nodes.find((n) => n.id === "milestone:m1")).toBeUndefined();
    expect(edges.filter((e) => e.id.startsWith("synthetic:"))).toEqual([]);
  });

  it("does NOT emit a synthetic edge for initiative-loose features", async () => {
    mockBlob(null);
    mockOwnedInitiative("i1");
    dbMock.milestone.findMany.mockResolvedValue([]);
    mockInitiativeFeatures([
      { id: "f-loose", title: "Loose", milestoneId: null },
    ]);

    const { edges } = await read("org-1", "initiative:i1");
    expect(edges.filter((e) => e.id.startsWith("synthetic:"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Legacy `milestone:<id>` refs are opaque — no projection.
// ---------------------------------------------------------------------------

describe("readCanvas (milestone: refs are opaque — no projection)", () => {
  it("projects no nodes or edges on a milestone: ref", async () => {
    // Pre-cutover deep links may carry `milestone:<id>` refs. The
    // parser folds them into `opaque`, every projector no-ops on
    // opaque scopes, and the read returns whatever is in the blob
    // (typically nothing, since these scopes shouldn't be authored
    // against either).
    mockBlob(null);
    // Mock features and milestones anyway — a regression that
    // resurrected the milestone-scope projector would surface as the
    // test seeing them.
    mockInitiatives([{ id: "i1", name: "x" }]);
    dbMock.feature.findMany.mockResolvedValue([
      { id: "leaked", title: "should not appear", status: "BACKLOG", workflowStatus: null, milestoneId: "m1", tasks: [] },
    ]);

    const { nodes, edges } = await read("org-1", "milestone:m1");
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });
});
