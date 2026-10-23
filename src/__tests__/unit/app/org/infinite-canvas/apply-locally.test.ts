import { describe, expect, it } from "vitest";
import { applyLocally, pendingRefIn } from "@/app/org/[githubLogin]/_components/infinite-canvas/useCanvasBoard";
import type { InitiativeTreeData } from "@/services/graph/workbench";

const tree: InitiativeTreeData = {
  nodes: [
    { ref_id: "f", type: "InitiativeFeature", properties: { name: "F" } },
    { ref_id: "s", type: "UserStory", properties: { text: "S" } },
    { ref_id: "r", type: "Requirement", properties: { text: "R", status: "proposed" } },
    { ref_id: "s2", type: "UserStory", properties: { text: "S2" } },
  ],
  edges: [
    { source: "f", target: "s", type: "HAS_STORY" },
    { source: "s", target: "r", type: "HAS_REQUIREMENT" },
    { source: "f", target: "s2", type: "HAS_STORY" },
  ],
  stage: { milestones: 0, features: 1, stories: 2, requirements: 1, unaccepted: 1 },
  truncated: false,
};

describe("applyLocally", () => {
  it("patches edited cards", () => {
    const t = applyLocally(tree, [{ op: "edit", ref: "r", fields: { status: "accepted", text: "R2" } }]);
    expect(t.nodes.find((n) => n.ref_id === "r")?.properties).toEqual({ text: "R2", status: "accepted" });
  });

  it("drops a deleted card with everything under it", () => {
    const t = applyLocally(tree, [{ op: "remove", ref: "s" }]);
    expect(t.nodes.map((n) => n.ref_id)).toEqual(["f", "s2"]);
    expect(t.edges).toEqual([{ source: "f", target: "s2", type: "HAS_STORY" }]);
  });

  it("shows an added story at once under its parent", () => {
    const ops = [{ op: "add" as const, temp: "x", type: "UserStory" as const, parent: "f", fields: { text: "New" } }];
    const t = applyLocally(tree, ops);
    const added = t.nodes.find((n) => n.properties.text === "New");
    expect(added?.type).toBe("UserStory");
    expect(added?.ref_id).toMatch(/^pending:/);
    expect(t.edges).toContainEqual({ source: "f", target: added!.ref_id, type: "HAS_STORY" });
    expect(tree.nodes).toHaveLength(4);
  });

  it("leaves the tree alone for adds it doesn't show early", () => {
    const ops = [{ op: "add" as const, temp: "x", type: "InitiativeFeature" as const, parent: "f", fields: { name: "N" } }];
    expect(applyLocally(tree, ops)).toBe(tree);
  });

  it("removing a story leaves the other stories of its parent in order, with no edges to the removed one", () => {
    const t = applyLocally(tree, [{ op: "remove", ref: "s" }]);
    const stories = t.edges.filter((e) => e.source === "f" && e.type === "HAS_STORY").map((e) => e.target);
    expect(stories).toEqual(["s2"]);
    expect(t.edges.some((e) => e.source === "s" || e.target === "s" || e.target === "r")).toBe(false);
  });

  it("removing a story just added (temp id) takes it and its edge out; the rest keep their order", () => {
    const added = applyLocally(tree, [
      { op: "add", temp: "x", type: "UserStory", parent: "f", fields: { text: "New" } },
    ]);
    const pendingId = added.nodes.find((n) => n.properties.text === "New")!.ref_id;
    const t = applyLocally(added, [{ op: "remove", ref: "s" }]);
    expect(t.edges.filter((e) => e.type === "HAS_STORY").map((e) => e.target)).toEqual(["s2", pendingId]);
  });
});

describe("pendingRefIn", () => {
  it("finds an edit, delete or parent that points at a card still saving", () => {
    expect(pendingRefIn([{ op: "remove", ref: "pending:s:1:0" }])).toBe("pending:s:1:0");
    expect(pendingRefIn([{ op: "edit", ref: "pending:s:1:0", fields: { text: "x" } }])).toBe("pending:s:1:0");
    expect(
      pendingRefIn([{ op: "add", temp: "r", type: "Requirement", parent: "pending:s:1:0", fields: { text: "x" } }]),
    ).toBe("pending:s:1:0");
  });

  it("is null for saved cards", () => {
    expect(pendingRefIn([{ op: "remove", ref: "s" }, { op: "edit", ref: "r", fields: { text: "x" } }])).toBeNull();
  });
});
