import { describe, test, expect, vi, beforeEach } from "vitest";
import type { ChoiceTreeData } from "@/services/graph/workbench";

vi.mock("@/lib/db", () => ({
  db: { workspace: { findFirst: vi.fn() }, user: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/ai/graphWriteAuth", () => ({ resolveGraphJarvis: vi.fn() }));
vi.mock("@/lib/pusher", () => ({ notifyBrainstormUpdated: vi.fn() }));
vi.mock("@/services/swarm/api/nodes", () => ({ addNode: vi.fn(), addEdgeV2: vi.fn(), updateNodeV2: vi.fn() }));
vi.mock("@/services/graph/workbench", () => ({ getChoiceTree: vi.fn() }));

import { db } from "@/lib/db";
import { resolveGraphJarvis } from "@/lib/ai/graphWriteAuth";
import { notifyBrainstormUpdated } from "@/lib/pusher";
import { addEdgeV2, addNode, updateNodeV2 } from "@/services/swarm/api/nodes";
import { getChoiceTree } from "@/services/graph/workbench";
import {
  newChoiceId,
  planBrainstormSave,
  saveBrainstormChanges,
  type BrainstormSave,
} from "@/services/graph/brainstorm-write";

const NOW = 1_760_000_000_000;
const actor = { id: "u1", login: "tom", name: "Tom" };

/** root question → options A (chosen), B (open); A → follow-up question F → option FA. */
function tree(): ChoiceTreeData {
  const q = (ref_id: string, props: Record<string, unknown> = {}) => ({
    ref_id,
    type: "Question" as const,
    properties: { text: ref_id, state: "open", ...props },
  });
  const o = (ref_id: string, props: Record<string, unknown> = {}) => ({
    ref_id,
    type: "Option" as const,
    properties: { text: ref_id, state: "open", ...props },
  });
  return {
    nodes: [q("root", { state: "decided" }), o("a", { state: "chosen", state_at: 5 }), o("b"), q("f"), o("fa")],
    edges: [
      { source: "root", target: "a" },
      { source: "root", target: "b" },
      { source: "a", target: "f" },
      { source: "f", target: "fa" },
    ],
    truncated: false,
  };
}

const plan = (save: BrainstormSave, t: ChoiceTreeData | null = tree()) =>
  planBrainstormSave(t, save, actor, "board", NOW);
const ok = (r: ReturnType<typeof plan>) => {
  if (!r.ok) throw new Error(r.message);
  return r.plan;
};

describe("newChoiceId", () => {
  test("starts with the 13-digit time, so it sorts with the workflow's run-time ids", () => {
    const id = newChoiceId(NOW);
    expect(id).toMatch(/^1760000000000-hive-\d{6}-[a-z0-9]{4}$/);
    expect([newChoiceId(NOW + 1), "1760000000000-job-x"].sort((x, y) => x.localeCompare(y))[0]).toBe(
      "1760000000000-job-x",
    );
    expect(newChoiceId(NOW)).not.toBe(newChoiceId(NOW));
  });
});

describe("planBrainstormSave", () => {
  test("a new option is a person's card with who and when", () => {
    const p = ok(
      plan({ root: "root", ops: [{ op: "add_option", temp: "t1", parent: "root", text: "  Cards on paper  " }] }),
    );
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0]).toMatchObject({
      temp: "t1",
      nodeType: "Option",
      parent: { ref: "root" },
      data: {
        text: "Cards on paper",
        made_by: "user",
        speaker: "Tom",
        actor_id: "u1",
        actor_login: "tom",
        created_at: NOW,
        state: "open",
        kind: "option",
      },
    });
    expect(p.creates[0].data.option_id).toMatch(/^1760000000000-hive-/);
  });

  test("a new brainstorm and its first options save in one batch", () => {
    const p = ok(
      plan(
        {
          root: null,
          ops: [
            { op: "add_question", temp: "q", parent: null, text: "What next?" },
            { op: "add_option", temp: "o1", parent: "q", text: "This" },
            { op: "choose", ref: "o1" },
          ],
        },
        null,
      ),
    );
    expect(p.creates.map((c) => [c.temp, c.parent])).toEqual([
      ["q", null],
      ["o1", { temp: "q" }],
    ]);
    // Choosing a card made in the same batch goes into its create, and decides its question.
    expect(p.creates[1].data.state).toBe("chosen");
    expect(p.creates[0].data.state).toBe("decided");
    expect(p.patches).toEqual({});
  });

  test("choose stamps the option and decides its question; other options stay as they are", () => {
    const p = ok(plan({ root: "root", ops: [{ op: "choose", ref: "fa", reason: "go with this" }] }));
    expect(p.patches.fa).toMatchObject({
      state: "chosen",
      state_by_id: "u1",
      state_by_login: "tom",
      state_at: NOW,
      state_reason: "go with this",
      state_source: "board",
    });
    expect(p.patches.f).toMatchObject({ state: "decided", state_reason: 'option "fa" chosen' });

    const two = ok(plan({ root: "root", ops: [{ op: "choose", ref: "b" }] }));
    expect(two.patches.b.state).toBe("chosen");
    expect(two.patches.a).toBeUndefined();
    expect(two.patches.root).toBeUndefined(); // already decided
  });

  test("deselecting the last chosen option reopens the question; another chosen one keeps it decided", () => {
    const last = ok(plan({ root: "root", ops: [{ op: "unchoose", ref: "a" }] }));
    expect(last.patches.a.state).toBe("open");
    expect(last.patches.root.state).toBe("open");

    const kept = ok(
      plan({
        root: "root",
        ops: [
          { op: "choose", ref: "b" },
          { op: "unchoose", ref: "a" },
        ],
      }),
    );
    expect(kept.patches.root).toBeUndefined();
  });

  test("dropping a chosen option reopens its question; reopen brings a dropped one back", () => {
    const p = ok(
      plan({
        root: "root",
        ops: [
          { op: "reject", ref: "a" },
          { op: "reopen", ref: "a" },
        ],
      }),
    );
    expect(p.patches.a.state).toBe("open");
    expect(p.patches.root.state).toBe("open");
  });

  test("remove soft-deletes the card and everything under it", () => {
    const p = ok(plan({ root: "root", ops: [{ op: "remove", ref: "a", reason: "wrong idea" }] }));
    expect(Object.keys(p.patches).sort()).toEqual(["a", "f", "fa"]);
    expect(p.patches.f).toMatchObject({
      deleted_at: NOW,
      is_deleted: true,
      removed_reason: "wrong idea",
      removed_by_id: "u1",
      removed_root: "root",
    });
  });

  test("text edits and links", () => {
    const p = ok(
      plan({
        root: "root",
        ops: [
          { op: "edit_text", ref: "b", text: "Better wording" },
          { op: "link", ref: "f", edge: "ABOUT", target: "initiative-1" },
        ],
      }),
    );
    expect(p.patches.b).toMatchObject({ text: "Better wording", edited_by_id: "u1", edited_at: NOW });
    expect(p.links).toEqual([{ edgeType: "ABOUT", source: { ref: "f" }, target: "initiative-1" }]);
  });

  test.each([
    ["a card that isn't on the tree", { op: "choose", ref: "elsewhere" }, "no longer on this brainstorm"],
    [
      "an option under an option",
      { op: "add_option", temp: "t", parent: "b", text: "x" },
      "options go under a question",
    ],
    ["choosing a question", { op: "choose", ref: "f" }, "only an option"],
    ["deselecting an open option", { op: "unchoose", ref: "b" }, "only a chosen option"],
    ["a temp id that is a real ref", { op: "add_option", temp: "root", parent: "root", text: "x" }, "its own id"],
    ["an empty card", { op: "add_option", temp: "t", parent: "root", text: "   " }, "write something"],
    [
      "a parentless card on an existing tree",
      { op: "add_question", temp: "t", parent: null, text: "x" },
      "goes under a card",
    ],
    ["removing the top question", { op: "remove", ref: "root" }, "can't be removed"],
    ["linking an option", { op: "link", ref: "b", edge: "ABOUT", target: "x1" }, "only a question"],
  ] as const)("refuses %s", (_, op, message) => {
    const r = plan({ root: "root", ops: [op as BrainstormSave["ops"][number]] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toContain(message);
    }
  });

  test("a card added under a card removed earlier in the batch is refused", () => {
    const r = plan({
      root: "root",
      ops: [
        { op: "remove", ref: "f" },
        { op: "add_option", temp: "t", parent: "f", text: "x" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  test("a card that changed since the client loaded it refuses the whole save", () => {
    const r = plan({
      root: "root",
      ops: [{ op: "choose", ref: "b" }],
      expected: { a: { state: "chosen", state_at: 4 }, b: { state: "open", state_at: null } },
    });
    expect(r).toMatchObject({ ok: false, status: 409, conflicts: ["a"] });
    expect(
      ok(plan({ root: "root", ops: [{ op: "choose", ref: "b" }], expected: { a: { state: "chosen", state_at: 5 } } }))
        .patches.b.state,
    ).toBe("chosen");
  });
});

describe("saveBrainstormChanges", () => {
  const config = { jarvisUrl: "https://j", apiKey: "k" };
  const caller = { slug: "hive", userId: "u1" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("USE_MOCKS", "false");
    vi.mocked(db.workspace.findFirst).mockResolvedValue({
      sourceControlOrgId: "org1",
      sourceControlOrg: { githubLogin: "stakwork" },
    } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({ name: "Tom", githubAuth: { githubUsername: "tom" } } as never);
    vi.mocked(getChoiceTree).mockResolvedValue({ ok: true, data: tree() });
    vi.mocked(resolveGraphJarvis).mockResolvedValue({
      ok: true,
      access: { workspaceId: "w1", workspaceSlug: "hive", config },
    });
    vi.mocked(addNode).mockResolvedValue({ success: true, ref_id: "new-1" });
    vi.mocked(addEdgeV2).mockResolvedValue({ success: true });
    vi.mocked(updateNodeV2).mockResolvedValue({ success: true });
  });

  test("creates the card, links it under its parent, patches, and tells open desks", async () => {
    const res = await saveBrainstormChanges(caller, {
      root: "root",
      ops: [
        { op: "add_option", temp: "t1", parent: "f", text: "New" },
        { op: "choose", ref: "b" },
      ],
    });
    expect(res).toEqual({ ok: true, data: { root: "root", created: { t1: "new-1" } } });
    expect(resolveGraphJarvis).toHaveBeenCalledWith("org1", "u1", { slug: "hive" });
    expect(addNode).toHaveBeenCalledWith(config, expect.objectContaining({ node_type: "Option" }));
    expect(addEdgeV2).toHaveBeenCalledWith(config, {
      edge: { edge_type: "PARENT_OF" },
      source: { ref_id: "f" },
      target: { ref_id: "new-1" },
    });
    expect(updateNodeV2).toHaveBeenCalledWith(config, "b", expect.objectContaining({ state: "chosen" }));
    expect(notifyBrainstormUpdated).toHaveBeenCalledWith("stakwork", { workspaceSlug: "hive", root: "root" });
  });

  test("a fresh id that already exists is a clash, not a merge", async () => {
    vi.mocked(addNode).mockResolvedValue({ success: true, ref_id: "old", alreadyExists: true });
    const res = await saveBrainstormChanges(caller, {
      root: "root",
      ops: [{ op: "add_option", temp: "t1", parent: "f", text: "New" }],
    });
    expect(res).toMatchObject({ ok: false, status: 502 });
    expect(addEdgeV2).not.toHaveBeenCalled();
  });

  test("a card whose parent link fails is soft-deleted again", async () => {
    vi.mocked(addEdgeV2).mockResolvedValue({ success: false, message: "no" });
    const res = await saveBrainstormChanges(caller, {
      root: "root",
      ops: [{ op: "add_option", temp: "t1", parent: "f", text: "New" }],
    });
    expect(res).toMatchObject({ ok: false, status: 502 });
    expect(updateNodeV2).toHaveBeenCalledWith(config, "new-1", expect.objectContaining({ is_deleted: true }));
  });

  test("a conflict returns 409 with the fresh tree and writes nothing", async () => {
    const res = await saveBrainstormChanges(caller, {
      root: "root",
      ops: [{ op: "choose", ref: "b" }],
      expected: { b: { state: "rejected", state_at: 1 } },
    });
    expect(res).toMatchObject({ ok: false, status: 409, conflicts: ["b"], tree: tree() });
    expect(updateNodeV2).not.toHaveBeenCalled();
    expect(resolveGraphJarvis).not.toHaveBeenCalled();
  });

  test("refused when the graph-write check refuses", async () => {
    vi.mocked(resolveGraphJarvis).mockResolvedValue({ ok: false, error: "Workspace not found or access denied." });
    const res = await saveBrainstormChanges(caller, { root: "root", ops: [{ op: "choose", ref: "b" }] });
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(updateNodeV2).not.toHaveBeenCalled();
  });

  test("a new brainstorm reports its new root", async () => {
    vi.mocked(addNode).mockResolvedValue({ success: true, ref_id: "new-root" });
    const res = await saveBrainstormChanges(caller, {
      root: null,
      ops: [{ op: "add_question", temp: "q", parent: null, text: "What next?" }],
    });
    expect(res).toEqual({ ok: true, data: { root: "new-root", created: { q: "new-root" } } });
    expect(getChoiceTree).not.toHaveBeenCalled();
    expect(addEdgeV2).not.toHaveBeenCalled();
  });
});
