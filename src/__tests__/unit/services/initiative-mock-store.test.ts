import { describe, test, expect, vi, beforeEach } from "vitest";
import { resetMockInitiativeStore } from "@/app/api/mock/graph/initiative-fixture";
import { resetMockBrainstormStore } from "@/app/api/mock/graph/brainstorm-store";
import { getChoiceTree, getInitiativeTree } from "@/services/graph/workbench";
import { saveInitiativeChanges } from "@/services/graph/initiative-write";

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn().mockResolvedValue({ sourceControlOrgId: "org-1", sourceControlOrg: null }) },
    user: { findUnique: vi.fn().mockResolvedValue({ name: "Dev", githubAuth: null }) },
  },
}));
vi.mock("@/lib/pusher", () => ({ notifyBrainstormUpdated: vi.fn(), notifyInitiativeUpdated: vi.fn() }));

const caller = { slug: "ws", userId: "u1" };

beforeEach(() => {
  vi.stubEnv("USE_MOCKS", "true");
  resetMockInitiativeStore();
  resetMockBrainstormStore();
});

describe("mock mode: a save reads back", () => {
  test("edits and new cards on the fixture initiative", async () => {
    const saved = await saveInitiativeChanges(caller, {
      root: "mock-initiative-onboarding",
      ops: [
        { op: "edit", ref: "mock-initiative-onboarding", fields: { name: "Renamed" } },
        {
          op: "add",
          temp: "m",
          type: "HiveMilestone",
          parent: "mock-initiative-onboarding",
          fields: { name: "Launch" },
        },
      ],
    });
    expect(saved.ok).toBe(true);
    const tree = await getInitiativeTree(caller, "mock-initiative-onboarding");
    if (!tree.ok) throw new Error(tree.message);
    expect(tree.data.nodes[0].properties.name).toBe("Renamed");
    expect(tree.data.stage.milestones).toBe(4);
    expect(tree.data.nodes.find((n) => n.properties.name === "Launch")?.properties.created_by).toBe("u1");
    // Another initiative doesn't see this one's saves.
    expect(await getInitiativeTree(caller, "mock-initiative-billing")).toMatchObject({
      ok: true,
      data: { stage: { milestones: 1 } },
    });
  });

  test("a removed story takes its requirements with it", async () => {
    const saved = await saveInitiativeChanges(caller, {
      root: "mock-initiative-onboarding",
      ops: [{ op: "remove", ref: "mock-s-repo-1" }],
    });
    expect(saved.ok).toBe(true);
    const tree = await getInitiativeTree(caller, "mock-initiative-onboarding");
    if (!tree.ok) throw new Error(tree.message);
    const ids = tree.data.nodes.map((n) => n.ref_id);
    expect(ids).not.toContain("mock-s-repo-1");
    expect(ids).not.toContain("mock-r-6");
    expect(ids).toContain("mock-s-gh-1");
  });

  test("a requirement moves between milestones and back to the backlog", async () => {
    const root = "mock-initiative-onboarding";
    const scheduled = async () => {
      const t = await getInitiativeTree(caller, root);
      if (!t.ok) throw new Error(t.message);
      return t.data.nodes.find((n) => n.ref_id === "mock-r-14")?.scheduled;
    };
    expect(await scheduled()).toBeUndefined();
    await saveInitiativeChanges(caller, {
      root,
      ops: [{ op: "schedule", ref: "mock-r-14", milestone: "mock-m-invite" }],
    });
    expect(await scheduled()).toEqual(["mock-m-invite"]);
    await saveInitiativeChanges(caller, { root, ops: [{ op: "schedule", ref: "mock-r-14", milestone: null }] });
    expect(await scheduled()).toBeUndefined();
  });

  test("choosing an answer marks it and makes its features; choosing another takes back what hadn't started", async () => {
    const root = "mock-initiative-onboarding";
    const choose = (option: string, chosen = true) =>
      saveInitiativeChanges(caller, { root, ops: [{ op: "choose", root: "mock-brainstorm-repo", option, chosen }] });
    expect((await choose("mock-brainstorm-repo-all")).ok).toBe(true);
    let tree = await getInitiativeTree(caller, root);
    if (!tree.ok) throw new Error(tree.message);
    const made = tree.data.nodes.find((n) => n.madeBy?.includes("mock-brainstorm-repo-all"));
    expect(made).toMatchObject({ type: "InitiativeFeature", properties: { name: "Watch every repo the app can see" } });
    // Repo picker, made by the earlier choice, has an architecture: it stays.
    expect(tree.data.nodes.some((n) => n.ref_id === "mock-f-repo")).toBe(true);
    const states = async () => {
      const c = await getChoiceTree(caller, "mock-brainstorm-repo");
      if (!c.ok) throw new Error(c.message);
      return Object.fromEntries(c.data.nodes.map((n) => [n.ref_id, n.properties.state]));
    };
    expect(await states()).toMatchObject({
      "mock-brainstorm-repo-all": "chosen",
      "mock-brainstorm-repo-picker": "open",
    });
    // Undo: the feature it made goes (nothing started on it).
    expect((await choose("mock-brainstorm-repo-all", false)).ok).toBe(true);
    tree = await getInitiativeTree(caller, root);
    if (!tree.ok) throw new Error(tree.message);
    expect(tree.data.nodes.some((n) => n.ref_id === made!.ref_id)).toBe(false);
    expect((await states())["mock-brainstorm-repo-all"]).toBe("open");
  });

  test("a new initiative is its own tree", async () => {
    const saved = await saveInitiativeChanges(caller, {
      root: null,
      ops: [
        { op: "add", temp: "i", type: "HiveInitiative", parent: null, fields: { name: "Fresh" } },
        { op: "add", temp: "b", type: "Brief", parent: "i", fields: { text: "Why" } },
      ],
    });
    if (!saved.ok) throw new Error(saved.message);
    const tree = await getInitiativeTree(caller, saved.data.root);
    if (!tree.ok) throw new Error(tree.message);
    expect(tree.data.nodes.map((n) => n.type)).toEqual(["HiveInitiative", "Brief"]);
  });
});
