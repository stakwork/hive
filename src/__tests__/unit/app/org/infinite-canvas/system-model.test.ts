import { describe, expect, it } from "vitest";

import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import type { Board, PlanNode } from "@/app/org/[githubLogin]/_components/infinite-canvas/board";
import {
  EXTENDS,
  IN_AREA,
  checkExtends,
  edgeMaps,
  graphUrn,
} from "@/app/org/[githubLogin]/_components/infinite-canvas/system/edges";
import {
  type SystemInput,
  UNASSIGNED,
  buildSystemModel,
  deriveDistrict,
  tierState,
} from "@/app/org/[githubLogin]/_components/infinite-canvas/system/model";
import {
  CELL_H,
  MAX_TIERS,
  STACK_SLOTS,
  layoutSystem,
} from "@/app/org/[githubLogin]/_components/infinite-canvas/system/layout";
import type { CanvasJob } from "@/lib/canvas/canvas-jobs";
import type { SystemMapDomainEdge, SystemMapDomainNode } from "@/types/system-map";

const sys = (refId: string, type: string, properties: Record<string, unknown> = {}): SystemMapDomainNode => ({
  refId,
  type,
  name: (properties.name as string) ?? refId,
  properties,
});
const link = (source: string, edgeType: string, target: string): SystemMapDomainEdge => ({ source, target, edgeType });

const NODES = [
  sys("z-int", "SysTrustZone", { name: "internal" }),
  sys("z-dev", "SysTrustZone", { name: "device" }),
  sys("auth", "SysComponent", { name: "auth", date_added_to_graph: 10 }),
  sys("web", "SysComponent", { name: "web app", date_added_to_graph: 20 }),
  sys("brain", "SysComponent", { name: "brain", date_added_to_graph: 30 }),
  sys("login", "SysInterface", { name: "login api" }),
  sys("users", "SysResource", { name: "users db", kind: "database" }),
  sys("repo-brain", "SysArtifact", { name: "stakwork/brain-service" }),
];
const EDGES = [
  link("auth", "IN_ZONE", "z-int"),
  link("brain", "IN_ZONE", "z-int"),
  link("web", "IN_ZONE", "z-dev"),
  link("auth", "EXPOSES", "login"),
  link("auth", "READS_FROM", "users"),
  link("brain", "DEPENDS_ON", "repo-brain"),
  link("web", "CALLS", "auth"),
];

const feat = (id: string, name: string, parent = "m1"): PlanNode => ({
  id,
  ws: "ws1",
  type: "feature",
  name,
  author: "person",
  parent,
});
const BOARD: Board = {
  nodes: [
    { id: "i1", ws: "ws1", type: "initiative", name: "Onboarding", author: "person" },
    { id: "m1", ws: "ws1", type: "milestone", name: "Sign-up", author: "person", parent: "i1" },
    feat("f-done", "Login flow"),
    feat("f-run", "Repo picker"),
    feat("f-plan", "Invite links"),
    feat("f-next", "Magic links"),
  ],
};

const pr = (number: number, repo: string, state: string): ArtifactRef => ({
  id: `pr-${number}`,
  kind: "pull_request",
  title: `PR ${number}`,
  source: { type: "inline", content: { url: `https://github.com/${repo}/pull/${number}`, repo, number, state } },
});
const job = (id: string, refId: string, state: CanvasJob["state"], who = "u1"): CanvasJob => ({
  jobId: id,
  title: `Job ${id}`,
  state,
  startedBy: { id: who, name: `User ${who}` },
  refId,
  initiativeRefId: "i1",
  updatedAt: 1,
});

const input = (extra: Partial<SystemInput> = {}): SystemInput => ({
  nodes: NODES,
  edges: EDGES,
  board: BOARD,
  jobsByRef: {
    "f-done": [job("j1", "f-done", "done")],
    "f-run": [job("j2", "f-run", "running", "u2")],
    // On the initiative itself: builds no feature.
    i1: [job("j3", "i1", "done")],
    "gone-feature": [job("j4", "gone-feature", "failed")],
  },
  artifactsByRef: {
    "f-done": [pr(1, "stakwork/auth", "merged")],
    "f-run": [pr(2, "stakwork/brain-service", "open")],
    stray: [pr(3, "stakwork/other", "open")],
  },
  edgeMaps: { inArea: new Map(), extendsOf: new Map() },
  ...extra,
});

describe("districts from the System Map", () => {
  const model = buildSystemModel(input());

  it("makes one district per component, grouped by zone in the Map's zone order", () => {
    expect(model.zones.map((z) => [z.key, z.districts.map((d) => d.id)])).toEqual([
      ["device", ["web"]],
      ["internal", ["auth", "brain"]],
      ["unassigned", [UNASSIGNED]],
    ]);
  });

  it("gives each district the nodes its component claims, in their slots", () => {
    const auth = model.districts.get("auth")!;
    expect(auth.claimed.map((c) => [c.id, c.type])).toEqual(
      expect.arrayContaining([
        ["login", "SysInterface"],
        ["users", "SysResource"],
      ]),
    );
    expect(auth.claimed.find((c) => c.id === "login")?.slot).toBe("front");
    expect(auth.claimed.find((c) => c.id === "users")?.slot).toBe("back");
  });

  it("draws data flows between districts only", () => {
    const wires = buildSystemModel(
      input({ edges: [...EDGES, link("web", "DATA_FLOW", "auth")] }),
    ).wires;
    expect(wires.every((w) => w.from !== w.to)).toBe(true);
  });

  it("is a lone Unassigned district when the map has no components", () => {
    const empty = buildSystemModel(input({ nodes: [], edges: [] }));
    expect(empty.mapped).toBe(false);
    expect(empty.zones.map((z) => z.key)).toEqual([UNASSIGNED]);
  });
});

describe("tier states", () => {
  it("maps work states to tiers", () => {
    expect(tierState("not-started")).toBe("planned");
    expect(tierState("in-progress")).toBe("building");
    expect(tierState("blocked")).toBe("building");
    expect(tierState("done")).toBe("built");
  });

  it("reads a feature's tier from its jobs and pull requests", () => {
    const { tiers } = buildSystemModel(input());
    expect(tiers.get("f-done")?.state).toBe("built");
    expect(tiers.get("f-run")?.state).toBe("building");
    expect(tiers.get("f-run")?.running).toBe(1);
    expect(tiers.get("f-run")?.people).toEqual([{ id: "u2", name: "User u2" }]);
    expect(tiers.get("f-plan")?.state).toBe("planned");
  });

  it("marks a blocked tier as needing attention in its district rollup", () => {
    const m = buildSystemModel(input({ jobsByRef: { "f-run": [job("j9", "f-run", "failed")] } }));
    expect(m.tiers.get("f-run")?.blocked).toBe(true);
    expect(m.districts.get(m.tiers.get("f-run")!.district)?.rollup.attention).toBe(true);
  });
});

describe("placing features", () => {
  it("derives the district from the repos of the pull requests, else Unassigned", () => {
    const { tiers } = buildSystemModel(input());
    expect(tiers.get("f-done")).toMatchObject({ district: "auth", placedBy: "derived" });
    // A SysArtifact the component claims names the repo.
    expect(tiers.get("f-run")).toMatchObject({ district: "brain", placedBy: "derived" });
    expect(tiers.get("f-plan")).toMatchObject({ district: UNASSIGNED, placedBy: "unassigned" });
  });

  it("prefers the stored IN_AREA edge", () => {
    const maps = edgeMaps([
      { fromUrn: graphUrn("o", "ws1", "InitiativeFeature", "f-plan"), toUrn: graphUrn("o", "ws1", "SysComponent", "web"), type: IN_AREA },
    ]);
    const { tiers } = buildSystemModel(input({ edgeMaps: maps }));
    expect(tiers.get("f-plan")).toMatchObject({ district: "web", placedBy: "edge" });
  });

  it("ignores an IN_AREA edge to a district that is gone", () => {
    const maps = { inArea: new Map([["f-plan", "removed"]]), extendsOf: new Map<string, string>() };
    expect(buildSystemModel(input({ edgeMaps: maps })).tiers.get("f-plan")?.placedBy).toBe("unassigned");
  });

  it("matches exact names over contained ones", () => {
    const ds = [
      { id: "a", names: ["brain-service-extras"] },
      { id: "b", names: ["brain-service"] },
    ];
    expect(deriveDistrict(["stakwork/brain-service"], ds)).toBe("b");
    expect(deriveDistrict(["x/unrelated"], ds)).toBeUndefined();
  });
});

describe("stacks (EXTENDS)", () => {
  it("is one one-tier stack per feature without edges", () => {
    const m = buildSystemModel(input());
    expect(m.districts.get(UNASSIGNED)!.stacks.map((s) => s.map((t) => t.id))).toEqual([["f-next"], ["f-plan"]]);
  });

  it("stacks a feature on the one it extends, in the same district", () => {
    const maps = { inArea: new Map(), extendsOf: new Map([["f-next", "f-plan"]]) };
    const m = buildSystemModel(input({ edgeMaps: maps }));
    expect(m.districts.get(UNASSIGNED)!.stacks.map((s) => s.map((t) => t.id))).toEqual([["f-plan", "f-next"]]);
    expect(m.tiers.get("f-next")?.extendsId).toBe("f-plan");
  });

  it("starts a new stack when the parent stands in another district", () => {
    const maps = { inArea: new Map(), extendsOf: new Map([["f-next", "f-done"]]) };
    const m = buildSystemModel(input({ edgeMaps: maps }));
    expect(m.tiers.get("f-next")?.extendsId).toBeUndefined();
  });
});

describe("EXTENDS rules", () => {
  const parents = new Map([["b", "a"]]);
  it("allows a new parent for a feature with none, and the same parent again", () => {
    expect(checkExtends(parents, "c", "b")).toEqual({ ok: true });
    expect(checkExtends(parents, "b", "a")).toEqual({ ok: true });
  });
  it("rejects a second parent, a cycle and a self edge", () => {
    expect(checkExtends(parents, "b", "c")).toEqual({ ok: false, reason: "second-parent" });
    expect(checkExtends(parents, "a", "b")).toEqual({ ok: false, reason: "cycle" });
    expect(checkExtends(parents, "a", "a")).toEqual({ ok: false, reason: "self" });
  });
  it("walks a corrupt chain at most a bounded number of steps", () => {
    const loop = new Map([
      ["x", "y"],
      ["y", "x"],
    ]);
    expect(checkExtends(loop, "q", "x")).toEqual({ ok: true });
  });
  it("drops stored rows that would break the rules", () => {
    const f = (id: string) => graphUrn("o", "w", "InitiativeFeature", id);
    const maps = edgeMaps([
      { fromUrn: f("b"), toUrn: f("a"), type: EXTENDS },
      { fromUrn: f("a"), toUrn: f("b"), type: EXTENDS },
      { fromUrn: f("b"), toUrn: f("c"), type: EXTENDS },
    ]);
    expect([...maps.extendsOf]).toEqual([["b", "a"]]);
  });
});

describe("unmapped", () => {
  it("lists the jobs and pull requests that build no feature of the plan", () => {
    const { unmapped } = buildSystemModel(input());
    expect(unmapped.jobs.map((j) => j.jobId).sort()).toEqual(["j3", "j4"]);
    expect(unmapped.prs.map((p) => p.artifact.id)).toEqual(["pr-3"]);
  });
});

describe("stable layout", () => {
  const rects = (m: ReturnType<typeof buildSystemModel>) => {
    const l = layoutSystem(m);
    return {
      districts: new Map([...l.districts].map(([id, d]) => [id, d.rect])),
      tiers: new Map([...l.tiers].map(([id, t]) => [id, t.rect])),
    };
  };

  it("stands tiers upward from a baseline", () => {
    const maps = { inArea: new Map(), extendsOf: new Map([["f-next", "f-plan"]]) };
    const l = layoutSystem(buildSystemModel(input({ edgeMaps: maps })));
    const base = l.tiers.get("f-plan")!.rect;
    const up = l.tiers.get("f-next")!.rect;
    expect(up.x).toBe(base.x);
    expect(up.y).toBeLessThan(base.y);
  });

  it("moves nothing already placed when a district is added last", () => {
    const before = rects(buildSystemModel(input()));
    const more = buildSystemModel(
      input({
        nodes: [...NODES, sys("zzz", "SysComponent", { name: "zzz", date_added_to_graph: 99 }), ],
        edges: [...EDGES, link("zzz", "IN_ZONE", "z-int")],
      }),
    );
    const after = rects(more);
    for (const [id, r] of before.districts) expect(after.districts.get(id)).toEqual(r);
    for (const [id, r] of before.tiers) expect(after.tiers.get(id)).toEqual(r);
    expect(after.districts.has("zzz")).toBe(true);
  });

  it("moves nothing already placed when a feature is added", () => {
    const before = rects(buildSystemModel(input()));
    const board: Board = { nodes: [...BOARD.nodes, feat("f-zzz", "Zed")] };
    const after = rects(buildSystemModel(input({ board })));
    for (const [id, r] of before.districts) expect(after.districts.get(id)).toEqual(r);
    for (const [id, r] of before.tiers) expect(after.tiers.get(id)).toEqual(r);
    expect(after.tiers.has("f-zzz")).toBe(true);
  });

  it("moves nothing already placed when a tier is added to a stack", () => {
    const one = { inArea: new Map(), extendsOf: new Map([["f-next", "f-plan"]]) };
    const board: Board = { nodes: [...BOARD.nodes, feat("f-top", "Top")] };
    const before = rects(buildSystemModel(input({ board, edgeMaps: one })));
    const two = { inArea: new Map(), extendsOf: new Map([...one.extendsOf, ["f-top", "f-next"]]) };
    const after = rects(buildSystemModel(input({ board, edgeMaps: two })));
    for (const [id, r] of before.tiers) if (id !== "f-top") expect(after.tiers.get(id)).toEqual(r);
    expect(after.tiers.has("f-top")).toBe(true);
  });

  it("counts what does not fit instead of drawing it", () => {
    const nodes: PlanNode[] = Array.from({ length: STACK_SLOTS + 2 }, (_, i) => feat(`g${String(i).padStart(2, "0")}`, `G${i}`));
    const m = buildSystemModel(input({ board: { nodes: [...BOARD.nodes, ...nodes] } }));
    const l = layoutSystem(m);
    expect(l.districts.get(UNASSIGNED)!.overflow).toBeGreaterThan(0);
    expect(MAX_TIERS).toBeGreaterThan(0);
    expect(l.districts.get(UNASSIGNED)!.rect.h).toBe(CELL_H);
  });
});
