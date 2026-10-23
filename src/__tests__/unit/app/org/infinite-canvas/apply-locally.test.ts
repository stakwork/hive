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
});

