import { describe, expect, it } from "vitest";
import { applyLocally } from "@/app/org/[githubLogin]/_components/infinite-canvas/useCanvasBoard";
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

  it("leaves the tree alone for adds", () => {
    const ops = [{ op: "add" as const, temp: "x", type: "UserStory" as const, parent: "f", fields: { text: "New" } }];
    expect(applyLocally(tree, ops)).toBe(tree);
  });
});

describe("applyLocally: scheduling", () => {
  it("moves a requirement to a milestone, or back to the backlog", () => {
    expect(
      applyLocally(tree, [{ op: "schedule", ref: "r", milestone: "m" }]).nodes.find((n) => n.ref_id === "r")?.scheduled,
    ).toEqual(["m"]);
    const scheduled = { ...tree, nodes: tree.nodes.map((n) => (n.ref_id === "r" ? { ...n, scheduled: ["m"] } : n)) };
    expect(
      applyLocally(scheduled, [{ op: "schedule", ref: "r", milestone: null }]).nodes.find((n) => n.ref_id === "r")
        ?.scheduled,
    ).toBeUndefined();
  });
});
