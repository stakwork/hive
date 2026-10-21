import { describe, test, expect, vi, beforeEach } from "vitest";
import type { InitiativeTreeData } from "@/services/graph/workbench";

vi.mock("@/lib/db", () => ({ db: { workspace: { findFirst: vi.fn() } } }));
vi.mock("@/lib/ai/graphWriteAuth", () => ({ resolveGraphJarvis: vi.fn() }));
vi.mock("@/services/swarm/api/nodes", () => ({ addNode: vi.fn(), addEdgeV2: vi.fn(), updateNodeV2: vi.fn() }));
vi.mock("@/services/graph/workbench", () => ({ getInitiativeTree: vi.fn() }));

import { db } from "@/lib/db";
import { resolveGraphJarvis } from "@/lib/ai/graphWriteAuth";
import { addEdgeV2, addNode, updateNodeV2 } from "@/services/swarm/api/nodes";
import { getInitiativeTree } from "@/services/graph/workbench";
import { planInitiativeSave, saveInitiativeChanges, type InitiativeSave } from "@/services/graph/initiative-write";

const NOW = new Date("2026-10-21T12:00:00.000Z");
const AT = NOW.toISOString();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** init → milestone m → feature f → story s → requirement r; init → brief b. */
function tree(): InitiativeTreeData {
  const n = (ref_id: string, type: InitiativeTreeData["nodes"][number]["type"]) => ({ ref_id, type, properties: {} });
  return {
    nodes: [
      n("init", "HiveInitiative"),
      n("b", "Brief"),
      n("m", "HiveMilestone"),
      n("f", "InitiativeFeature"),
      n("s", "UserStory"),
      n("r", "Requirement"),
    ],
    edges: [],
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
  test("edits stamp updated_at and merge per node", () => {
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
      init: { name: "Renamed", description: "More", updated_at: AT },
      b: { text: "Because.", updated_at: AT },
    });
  });

  test("a new node gets a UUID key, provenance, proposed status, and the right edge to its parent", () => {
    const p = ok(
      plan({
        root: "init",
        ops: [
          { op: "add", temp: "t1", type: "InitiativeFeature", parent: "m", fields: { name: "Billing" } },
          { op: "add", temp: "t2", type: "UserStory", parent: "t1", fields: { text: "As a payer…" } },
          { op: "add", temp: "t3", type: "Requirement", parent: "t2", fields: { text: "Card form" } },
        ],
      }),
    );
    expect(p.creates.map((c) => [c.nodeType, c.parent, c.edgeType])).toEqual([
      ["InitiativeFeature", { ref: "m" }, "HAS_FEATURE"],
      ["UserStory", { temp: "t1" }, "HAS_STORY"],
      ["Requirement", { temp: "t2" }, "HAS_REQUIREMENT"],
    ]);
    const data = p.creates[0].data;
    expect(data).toMatchObject({
      name: "Billing",
      status: "proposed",
      created_at: AT,
      updated_at: AT,
      created_by: "u1",
      created_by_kind: "human",
    });
    expect(String(data.feature_id)).toMatch(UUID);
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
    ).toEqual({
      status: "accepted",
      updated_at: AT,
    });
  });

  test("refuses wrong parents, missing required fields and misplaced initiatives", () => {
    expect(
      fails({ root: "init", ops: [{ op: "add", temp: "x", type: "Requirement", parent: "f", fields: { text: "t" } }] }),
    ).toMatch(/can't go under a InitiativeFeature/);
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

describe("saveInitiativeChanges", () => {
  const caller = { slug: "ws", userId: "u1" };
  const config = { jarvisUrl: "https://jarvis", apiKey: "k" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("USE_MOCKS", "false");
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ sourceControlOrgId: "org-1" } as never);
    vi.mocked(getInitiativeTree).mockResolvedValue({ ok: true, data: tree() });
    vi.mocked(resolveGraphJarvis).mockResolvedValue({ ok: true, access: { config } } as never);
    vi.mocked(addNode).mockResolvedValue({ success: true, ref_id: "new-1" });
    vi.mocked(addEdgeV2).mockResolvedValue({ success: true } as never);
    vi.mocked(updateNodeV2).mockResolvedValue({ success: true } as never);
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
    ]);
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
