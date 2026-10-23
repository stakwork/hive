import { describe, test, expect, vi, beforeEach } from "vitest";
import type { InitiativeTreeData } from "@/services/graph/workbench";

vi.mock("@/lib/db", () => ({ db: { workspace: { findFirst: vi.fn() } } }));
vi.mock("@/lib/ai/graphWriteAuth", () => ({ resolveGraphJarvis: vi.fn() }));
vi.mock("@/services/swarm/api/nodes", () => ({
  addNode: vi.fn(),
  addEdgeV2: vi.fn(),
  updateNodeV2: vi.fn(),
}));
vi.mock("@/services/graph/workbench", () => ({ getInitiativeTree: vi.fn(), getChoiceTree: vi.fn() }));
vi.mock("@/services/graph/brainstorm-write", () => ({ saveBrainstormChanges: vi.fn() }));
vi.mock("@/lib/pusher", () => ({ notifyInitiativeUpdated: vi.fn() }));

import { db } from "@/lib/db";
import { resolveGraphJarvis } from "@/lib/ai/graphWriteAuth";
import { addEdgeV2, addNode, updateNodeV2 } from "@/services/swarm/api/nodes";
import { getChoiceTree, getInitiativeTree, type ChoiceTreeData } from "@/services/graph/workbench";
import { saveBrainstormChanges } from "@/services/graph/brainstorm-write";
import { notifyInitiativeUpdated } from "@/lib/pusher";
import {
  makesOf,
  planChoice,
  planInitiativeSave,
  saveInitiativeChanges,
  type InitiativeSave,
} from "@/services/graph/initiative-write";

const NOW = new Date("2026-10-21T12:00:00.000Z");
const AT = NOW.toISOString();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * init → brief b, story s → requirement r, milestone m (sequence 1) → feature f
 * → architecture a. Brainstorm "q-root" is about m; feature f was made by
 * answer "o-a" and has an architecture (work started); feature f2, made by
 * "o-b", has none.
 */
function tree(): InitiativeTreeData {
  const n = (ref_id: string, type: InitiativeTreeData["nodes"][number]["type"], extra = {}) => ({
    ref_id,
    type,
    properties: {},
    ...extra,
  });
  return {
    nodes: [
      n("init", "HiveInitiative"),
      n("b", "Brief"),
      { ...n("m", "HiveMilestone", { brainstorms: ["q-root"] }), properties: { sequence: 1 } },
      n("f", "InitiativeFeature", { madeBy: ["o-a"] }),
      n("f2", "InitiativeFeature", { madeBy: ["o-b"] }),
      n("a", "Architecture"),
      n("s", "UserStory"),
      n("r", "Requirement"),
    ],
    edges: [
      { source: "init", target: "m", type: "HAS_MILESTONE" },
      { source: "m", target: "f", type: "HAS_FEATURE" },
      { source: "m", target: "f2", type: "HAS_FEATURE" },
      { source: "f", target: "a", type: "HAS_ARCHITECTURE" },
      { source: "init", target: "s", type: "HAS_STORY" },
      { source: "s", target: "r", type: "HAS_REQUIREMENT" },
    ],
    stage: { milestones: 1, features: 1, stories: 1, requirements: 1, unaccepted: 1 },
    truncated: false,
  };
}

const plan = (save: InitiativeSave, t: InitiativeTreeData | null = tree()) =>
  planInitiativeSave(t, save, "u1", "org-1", NOW);
const ok = (r: ReturnType<typeof plan>) => {
  if (!r.ok) throw new Error(r.message);
  return r.plan;
};
const fails = (save: InitiativeSave, t: InitiativeTreeData | null = tree()) => {
  const r = plan(save, t);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.message;
};

describe("planInitiativeSave", () => {
  test("edits merge per node and never send updated_at", () => {
    const p = ok(
      plan({
        root: "init",
        ops: [
          { op: "edit", ref: "init", fields: { name: "Renamed" } },
          { op: "edit", ref: "b", fields: { text: "Because." } },
          { op: "edit", ref: "init", fields: { description: "More" } },
        ],
      }),
    );
    expect(p.creates).toEqual([]);
    expect(p.patches).toEqual({
      init: { name: "Renamed", description: "More" },
      b: { text: "Because." },
    });
  });

  test("removes a story or requirement as a soft delete; nothing else", () => {
    const p = ok(
      plan({
        root: "init",
        ops: [
          { op: "remove", ref: "s" },
          { op: "remove", ref: "r" },
        ],
      }),
    );
    expect(p.patches).toEqual({
      s: { deleted_at: NOW.getTime(), is_deleted: true },
      r: { deleted_at: NOW.getTime(), is_deleted: true },
    });
    expect(fails({ root: "init", ops: [{ op: "remove", ref: "f" }] })).toMatch(/can't be deleted/);
    expect(fails({ root: "init", ops: [{ op: "remove", ref: "elsewhere" }] })).toMatch(/isn't part of this initiative/);
  });

  test("removing a story patches only that story: a story's number is its place in the list, so siblings need no write", () => {
    const p = ok(plan({ root: "init", ops: [{ op: "remove", ref: "s" }] }));
    expect(Object.keys(p.patches)).toEqual(["s"]);
    expect(p.creates).toEqual([]);
  });

  test("a new node gets a UUID key, provenance, proposed status, and the right edge to its parent", () => {
    const p = ok(
      plan({
        root: "init",
        ops: [
          { op: "add", temp: "t1", type: "InitiativeFeature", parent: "m", fields: { name: "Billing" } },
          { op: "add", temp: "t2", type: "UserStory", parent: "init", fields: { text: "As a payer…" } },
          { op: "add", temp: "t3", type: "Requirement", parent: "t2", fields: { text: "Card form" } },
        ],
      }),
    );
    expect(p.creates.map((c) => [c.nodeType, c.parent, c.edgeType])).toEqual([
      ["InitiativeFeature", { ref: "m" }, "HAS_FEATURE"],
      ["UserStory", { ref: "init" }, "HAS_STORY"],
      ["Requirement", { temp: "t2" }, "HAS_REQUIREMENT"],
    ]);
    const data = p.creates[0].data;
    expect(data).toMatchObject({
      name: "Billing",
      status: "proposed",
      created_at: AT,
      created_by: "u1",
      created_by_kind: "human",
    });
    expect(String(data.feature_id)).toMatch(UUID);
    expect(data).not.toHaveProperty("updated_at");
    expect(p.creates[2].data.requirement_id).not.toBe(p.creates[1].data.story_id);
  });

  test("a new initiative starts a new plan, carries the org, and its children follow", () => {
    const p = ok(
      plan(
        {
          root: null,
          ops: [
            { op: "add", temp: "i", type: "HiveInitiative", parent: null, fields: { name: "Onboarding" } },
            { op: "add", temp: "b", type: "Brief", parent: "i", fields: { text: "Why" } },
          ],
        },
        null,
      ),
    );
    expect(p.creates[0]).toMatchObject({ nodeType: "HiveInitiative", parent: null, edgeType: null });
    expect(p.creates[0].data).toMatchObject({ name: "Onboarding", org_id: "org-1" });
    expect(String(p.creates[0].data.initiative_id)).toMatch(UUID);
    expect(p.creates[0].data).not.toHaveProperty("status");
    expect(p.creates[1]).toMatchObject({ parent: { temp: "i" }, edgeType: "HAS_BRIEF" });
  });

  test("refuses edits outside the tree, unknown fields, bad statuses and empty names", () => {
    expect(fails({ root: "init", ops: [{ op: "edit", ref: "elsewhere", fields: { name: "x" } }] })).toMatch(
      /isn't part of this initiative/,
    );
    expect(fails({ root: "init", ops: [{ op: "edit", ref: "r", fields: { is_deleted: "true" } }] })).toMatch(
      /no editable field "is_deleted"/,
    );
    expect(fails({ root: "init", ops: [{ op: "edit", ref: "init", fields: { initiative_id: "new" } }] })).toMatch(
      /no editable field/,
    );
    expect(fails({ root: "init", ops: [{ op: "edit", ref: "r", fields: { status: "done" } }] })).toMatch(
      /proposed, accepted, dropped/,
    );
    expect(fails({ root: "init", ops: [{ op: "edit", ref: "init", fields: { name: "  " } }] })).toMatch(/empty/);
    expect(fails({ root: "init", ops: [{ op: "edit", ref: "m", fields: { sequence: "2" } }] })).toMatch(/wrong type/);
    expect(
      ok(plan({ root: "init", ops: [{ op: "edit", ref: "r", fields: { status: "accepted" } }] })).patches.r,
    ).toEqual({ status: "accepted" });
  });

  test("refuses wrong parents, missing required fields and misplaced initiatives", () => {
    expect(
      fails({ root: "init", ops: [{ op: "add", temp: "x", type: "Requirement", parent: "f", fields: { text: "t" } }] }),
    ).toMatch(/can't go under a InitiativeFeature/);
    // The problem lives on the initiative: a story can't hang off a feature any more.
    expect(
      fails({ root: "init", ops: [{ op: "add", temp: "x", type: "UserStory", parent: "f", fields: { text: "t" } }] }),
    ).toMatch(/can't go under a InitiativeFeature/);
    // Strut writes the architecture: not edited or deleted here.
    expect(fails({ root: "init", ops: [{ op: "edit", ref: "a", fields: { name: "x" } }] })).toMatch(
      /isn't edited here/,
    );
    expect(fails({ root: "init", ops: [{ op: "remove", ref: "a" }] })).toMatch(/can't be deleted/);
    expect(
      fails({
        root: "init",
        ops: [{ op: "add", temp: "x", type: "HiveMilestone", parent: null, fields: { name: "M" } }],
      }),
    ).toMatch(/needs a parent/);
    expect(
      fails({ root: "init", ops: [{ op: "add", temp: "x", type: "UserStory", parent: "f", fields: {} }] }),
    ).toMatch(/needs "text"/);
    expect(
      fails({
        root: "init",
        ops: [{ op: "add", temp: "x", type: "HiveInitiative", parent: null, fields: { name: "I" } }],
      }),
    ).toMatch(/first change of a new plan/);
    expect(
      fails(
        { root: null, ops: [{ op: "add", temp: "x", type: "Brief", parent: "init", fields: { text: "t" } }] },
        null,
      ),
    ).toMatch(/isn't part of this initiative/);
    expect(
      fails({
        root: "init",
        ops: [
          { op: "add", temp: "x", type: "HiveMilestone", parent: "init", fields: { name: "A" } },
          { op: "add", temp: "x", type: "HiveMilestone", parent: "init", fields: { name: "B" } },
        ],
      }),
    ).toMatch(/duplicate card id/);
  });
});

/** "q-root": a question about milestone m, answers o-a (chosen, makes two), o-b, and o-legacy (an old Choice). */
function choices(chosen = "o-a"): ChoiceTreeData {
  const option = (ref_id: string, props: Record<string, unknown>, extra = {}) => ({
    ref_id,
    type: "Option" as const,
    properties: { state: ref_id === chosen ? "chosen" : "open", ...props },
    ...extra,
  });
  return {
    nodes: [
      { ref_id: "q-root", type: "Question", properties: { text: "How?", state: "decided" } },
      option(
        "o-a",
        { text: "Cache it", makes: ["Repo cache", "Webhook"] },
        {
          effects: [
            { ref_id: "e1", name: "Fast", description: "", direction: "pro", impact: 1, against: ["r", "elsewhere"] },
          ],
        },
      ),
      option("o-b", { text: "Page live" }),
      { ref_id: "o-legacy", type: "Choice", properties: { text: "Old" } },
    ],
    edges: [
      { source: "q-root", target: "o-a" },
      { source: "q-root", target: "o-b" },
      { source: "q-root", target: "o-legacy" },
    ],
    truncated: false,
  };
}
const choose = (option: string, c = choices(), t = tree(), chosen = true) =>
  planChoice(t, c, { root: "q-root", option, chosen }, "u1", "org-1", NOW);

describe("planChoice", () => {
  test("choosing an answer makes what it makes one level below, linked RESULTED_IN, features SATISFYING its pros", () => {
    const r = choose("o-a", choices("o-b"));
    if (!r.ok) throw new Error(r.message);
    expect(r.choice.undo).toBe(false);
    expect(r.choice.brainstormOps).toEqual([
      { op: "unchoose", ref: "o-b" },
      { op: "choose", ref: "o-a" },
    ]);
    expect(r.choice.plan.creates.map((c) => [c.nodeType, c.data.name, c.parent, c.edgeType])).toEqual([
      ["InitiativeFeature", "Repo cache", { ref: "m" }, "HAS_FEATURE"],
      ["InitiativeFeature", "Webhook", { ref: "m" }, "HAS_FEATURE"],
    ]);
    expect(r.choice.plan.creates[0].data).toMatchObject({
      status: "proposed",
      created_by: "u1",
      created_by_kind: "human",
    });
    expect(r.choice.plan.links).toEqual([
      { edgeType: "RESULTED_IN", source: { ref: "o-a" }, target: { temp: "made-0" } },
      { edgeType: "SATISFIES", source: { temp: "made-0" }, target: { ref: "r" } },
      { edgeType: "RESULTED_IN", source: { ref: "o-a" }, target: { temp: "made-1" } },
      { edgeType: "SATISFIES", source: { temp: "made-1" }, target: { ref: "r" } },
    ]);
    // What the earlier choice (o-b) made goes, as nothing has started on it; f, with an architecture, stays.
    expect(r.choice.plan.patches.f2).toMatchObject({ is_deleted: true, deleted_at: NOW.getTime() });
    expect(r.choice.plan.patches.f).toBeUndefined();
    expect(r.choice.plan.patches.init).toBeUndefined();
  });

  test("taking a choice back opens it again and takes back what it made, unless work started", () => {
    const r = choose("o-a", choices(), tree(), false);
    if (!r.ok) throw new Error(r.message);
    expect(r.choice.undo).toBe(true);
    expect(r.choice.brainstormOps).toEqual([{ op: "unchoose", ref: "o-a" }]);
    expect(r.choice.plan.creates).toEqual([]);
    // f, made by o-a, has an architecture: it stays. f2 was made by another answer: untouched.
    expect(r.choice.plan.patches.f).toBeUndefined();
    expect(r.choice.plan.patches.f2).toBeUndefined();
  });

  test("choosing is safe to repeat: an already-chosen answer only makes what it hasn't made yet", () => {
    const t = tree();
    t.nodes = t.nodes.map((n) => (n.ref_id === "f" ? { ...n, properties: { name: "Repo cache" } } : n));
    const r = choose("o-a", choices("o-a"), t);
    if (!r.ok) throw new Error(r.message);
    // Already chosen: no state change, and "Repo cache" (made earlier, still standing) isn't made again.
    expect(r.choice.brainstormOps).toEqual([]);
    expect(r.choice.plan.creates.map((c) => c.data.name)).toEqual(["Webhook"]);
    // Taking back a choice that isn't chosen changes no state.
    const back = choose("o-b", choices("o-a"), tree(), false);
    expect(back.ok && back.choice.brainstormOps).toEqual([]);
  });

  test("an initiative's answers make milestones, numbered after the road; a feature's make nothing here", () => {
    const t = tree();
    t.nodes = t.nodes.map((n) =>
      n.ref_id === "m" ? { ...n, brainstorms: [] } : n.ref_id === "init" ? { ...n, brainstorms: ["q-root"] } : n,
    );
    const r = choose("o-b", choices("none"), t);
    if (!r.ok) throw new Error(r.message);
    expect(r.choice.plan.creates.map((c) => [c.nodeType, c.data.name, c.data.sequence, c.edgeType])).toEqual([
      ["HiveMilestone", "Page live", 2, "HAS_MILESTONE"],
    ]);
    t.nodes = t.nodes.map((n) =>
      n.ref_id === "init" ? { ...n, brainstorms: [] } : n.ref_id === "f2" ? { ...n, brainstorms: ["q-root"] } : n,
    );
    const onFeature = choose("o-b", choices("none"), t);
    if (!onFeature.ok) throw new Error(onFeature.message);
    expect(onFeature.choice.plan.creates).toEqual([]);
    expect(onFeature.choice.brainstormOps).toEqual([{ op: "choose", ref: "o-b" }]);
  });

  test("refuses a brainstorm about something else, an unknown answer and a legacy Choice", () => {
    const t = tree();
    t.nodes = t.nodes.map((n) => ({ ...n, brainstorms: undefined }));
    expect(choose("o-a", choices(), t)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/isn't about this initiative/),
    });
    expect(choose("nope")).toMatchObject({
      ok: false,
      message: expect.stringMatching(/isn't part of this brainstorm/),
    });
    expect(choose("o-legacy")).toMatchObject({
      ok: false,
      message: expect.stringMatching(/isn't part of this brainstorm/),
    });
  });

  test("makesOf: strut's list when set (empty makes nothing), else the answer's words, capped", () => {
    expect(makesOf({ text: "A", makes: ["x", " ", 3, "y"] })).toEqual(["x", "y"]);
    expect(makesOf({ text: "A", makes: [] })).toEqual([]);
    expect(makesOf({ text: "Answer" })).toEqual(["Answer"]);
    expect(makesOf({ makes: Array.from({ length: 20 }, (_, i) => `m${i}`) })).toHaveLength(12);
  });

  test("makesOf: strut writes `makes` as JSON text (Jarvis 135 `?string`); text that isn't a list is ignored", () => {
    expect(makesOf({ text: "A", makes: '["Guided workspace setup","Repo picker"]' })).toEqual([
      "Guided workspace setup",
      "Repo picker",
    ]);
    expect(makesOf({ text: "A", makes: "[]" })).toEqual([]);
    expect(makesOf({ text: "A", makes: "Repo picker" })).toEqual(["A"]);
    expect(makesOf({ text: "A", makes: '{"name":"x"}' })).toEqual(["A"]);
  });

  test("a choice must be saved on its own", () => {
    expect(
      fails({
        root: "init",
        ops: [
          { op: "edit", ref: "init", fields: { name: "x" } },
          { op: "choose", root: "q-root", option: "o-a", chosen: true },
        ],
      }),
    ).toMatch(/on its own/);
  });
});

describe("saveInitiativeChanges", () => {
  const caller = { slug: "ws", userId: "u1" };
  const config = { jarvisUrl: "https://jarvis", apiKey: "k" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("USE_MOCKS", "false");
    vi.mocked(db.workspace.findFirst).mockResolvedValue({
      sourceControlOrgId: "org-1",
      sourceControlOrg: { githubLogin: "acme" },
    } as never);
    vi.mocked(getInitiativeTree).mockResolvedValue({ ok: true, data: tree() });
    vi.mocked(resolveGraphJarvis).mockResolvedValue({ ok: true, access: { config } } as never);
    vi.mocked(addNode).mockResolvedValue({ success: true, ref_id: "new-1" });
    vi.mocked(addEdgeV2).mockResolvedValue({ success: true } as never);
    vi.mocked(updateNodeV2).mockResolvedValue({ success: true } as never);
    vi.mocked(getChoiceTree).mockResolvedValue({ ok: true, data: choices("o-b") });
    vi.mocked(saveBrainstormChanges).mockResolvedValue({ ok: true, data: { root: "q-root", created: {} } });
  });


  test("a choice saves the answer's state through the brainstorm writer, then what it makes", async () => {
    vi.mocked(getChoiceTree).mockResolvedValue({ ok: true, data: choices("none") });
    const res = await saveInitiativeChanges(caller, {
      root: "init",
      ops: [{ op: "choose", root: "q-root", option: "o-a", chosen: true }],
    });
    expect(res).toEqual({ ok: true, data: { root: "init", created: { "made-0": "new-1", "made-1": "new-1" } } });
    expect(saveBrainstormChanges).toHaveBeenCalledWith(caller, { root: "q-root", ops: [{ op: "choose", ref: "o-a" }] });
    expect(vi.mocked(addNode).mock.calls.map((c) => c[1].node_type)).toEqual([
      "InitiativeFeature",
      "InitiativeFeature",
    ]);
    expect(addEdgeV2).toHaveBeenCalledWith(config, {
      edge: { edge_type: "RESULTED_IN" },
      source: { ref_id: "o-a" },
      target: { ref_id: "new-1" },
    });
  });

  test("a choice the brainstorm writer refuses writes nothing else", async () => {
    vi.mocked(saveBrainstormChanges).mockResolvedValue({ ok: false, status: 409, message: "changed" });
    expect(
      await saveInitiativeChanges(caller, {
        root: "init",
        ops: [{ op: "choose", root: "q-root", option: "o-a", chosen: true }],
      }),
    ).toEqual({ ok: false, status: 409, message: "changed" });
    expect(addNode).not.toHaveBeenCalled();
  });

  test("writes new nodes, links them, then patches, through the workspace's Jarvis", async () => {
    const res = await saveInitiativeChanges(caller, {
      root: "init",
      ops: [
        { op: "add", temp: "t1", type: "HiveMilestone", parent: "init", fields: { name: "Beta" } },
        { op: "edit", ref: "init", fields: { name: "Renamed" } },
      ],
    });
    expect(res).toEqual({ ok: true, data: { root: "init", created: { t1: "new-1" } } });
    expect(resolveGraphJarvis).toHaveBeenCalledWith("org-1", "u1", { slug: "ws" });
    expect(vi.mocked(addNode).mock.calls[0][1]).toMatchObject({
      node_type: "HiveMilestone",
      node_data: { name: "Beta" },
    });
    expect(addEdgeV2).toHaveBeenCalledWith(config, {
      edge: { edge_type: "HAS_MILESTONE" },
      source: { ref_id: "init" },
      target: { ref_id: "new-1" },
    });
    expect(vi.mocked(updateNodeV2).mock.calls[0].slice(1, 3)).toEqual([
      "init",
      expect.objectContaining({ name: "Renamed" }),
    ]); // The org's open canvases hear about it.
    expect(notifyInitiativeUpdated).toHaveBeenCalledWith("acme", { workspaceSlug: "ws", root: "init" });
  });

  test("a failed link soft-deletes the new node again", async () => {
    vi.mocked(addEdgeV2).mockResolvedValue({ success: false, message: "nope" } as never);
    const res = await saveInitiativeChanges(caller, {
      root: "init",
      ops: [{ op: "add", temp: "t1", type: "HiveMilestone", parent: "init", fields: { name: "Beta" } }],
    });
    expect(res).toEqual({ ok: false, status: 502, message: "nope" });
    expect(vi.mocked(updateNodeV2).mock.calls[0].slice(1, 3)).toEqual([
      "new-1",
      expect.objectContaining({ is_deleted: true }),
    ]);
  });

  test("an initiative no longer in the graph is a 404, and a refused write auth a 403", async () => {
    vi.mocked(getInitiativeTree).mockResolvedValue({ ok: true, data: { ...tree(), nodes: [] } });
    expect(
      await saveInitiativeChanges(caller, { root: "init", ops: [{ op: "edit", ref: "init", fields: {} }] }),
    ).toMatchObject({ ok: false, status: 404 });
    vi.mocked(getInitiativeTree).mockResolvedValue({ ok: true, data: tree() });
    vi.mocked(resolveGraphJarvis).mockResolvedValue({ ok: false, error: "denied" } as never);
    expect(
      await saveInitiativeChanges(caller, { root: "init", ops: [{ op: "edit", ref: "init", fields: { name: "x" } }] }),
    ).toEqual({ ok: false, status: 403, message: "denied" });
    expect(addNode).not.toHaveBeenCalled();
    expect(updateNodeV2).not.toHaveBeenCalled();
  });

  test("a new initiative returns its own ref_id as root", async () => {
    const res = await saveInitiativeChanges(caller, {
      root: null,
      ops: [{ op: "add", temp: "i", type: "HiveInitiative", parent: null, fields: { name: "New" } }],
    });
    expect(res).toEqual({ ok: true, data: { root: "new-1", created: { i: "new-1" } } });
    expect(getInitiativeTree).not.toHaveBeenCalled();
  });
});
