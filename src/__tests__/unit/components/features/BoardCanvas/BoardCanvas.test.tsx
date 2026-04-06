// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock @xyflow/react
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: any) =>
    React.createElement("div", { "data-testid": "react-flow" }, children),
  ReactFlowProvider: ({ children }: any) =>
    React.createElement(React.Fragment, null, children),
  useNodesState: (initial: any) => [initial, vi.fn(), vi.fn()],
  useEdgesState: (initial: any) => [initial, vi.fn(), vi.fn()],
  useReactFlow: () => ({ fitView: vi.fn() }),
  Controls: () => React.createElement("div", { "data-testid": "controls" }),
  Background: () => React.createElement("div", { "data-testid": "background" }),
  BackgroundVariant: { Dots: "dots" },
  MarkerType: { ArrowClosed: "arrowclosed" },
}));

// Mock dagre layout — return nodes unchanged (positions stay 0,0)
vi.mock("@/components/features/DependencyGraph/layouts/dagre", () => ({
  getLayoutedElements: (nodes: any, edges: any) => ({ nodes, edges }),
}));

vi.mock("@/components/features/DependencyGraph/nodes", () => ({
  RoadmapTaskNode: ({ data }: any) =>
    React.createElement("div", { "data-testid": `task-node-${data.id}` }, data.title),
}));

vi.mock("@/components/features/BoardCanvas/FeatureGroupNode", () => ({
  FeatureGroupNode: ({ data }: any) =>
    React.createElement(
      "div",
      { "data-testid": `feature-group-${data.featureId}` },
      data.title,
    ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import {
  BoardCanvas,
  buildNodesAndEdges,
  TASK_NODE_HEIGHT,
  HEADER_HEIGHT,
  GROUP_PADDING,
} from "@/components/features/BoardCanvas";
import type { BoardFeature } from "@/types/roadmap";

const makeTask = (overrides: Partial<any> = {}) => ({
  id: "task-1",
  title: "Task 1",
  status: "TODO",
  priority: "MEDIUM",
  dependsOnTaskIds: [],
  featureId: "feature-1",
  systemAssigneeType: null,
  order: 0,
  description: null,
  phaseId: null,
  workspaceId: "ws-1",
  bountyCode: null,
  autoMerge: false,
  deploymentStatus: null,
  deployedToStagingAt: null,
  deployedToProductionAt: null,
  workflowStatus: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  assignee: null,
  repository: null,
  phase: null,
  ...overrides,
});

const makeFeature = (
  id: string,
  tasks: any[] = [],
  status: string = "IN_PROGRESS",
): BoardFeature => ({
  id,
  title: `Feature ${id}`,
  status: status as any,
  priority: "MEDIUM" as any,
  tasks,
});

describe("BoardCanvas — node list construction", () => {
  const noop = () => {};

  it("creates one group node per feature", () => {
    const features = [
      makeFeature("f-1", [makeTask({ id: "t-1", featureId: "f-1" })]),
      makeFeature("f-2", [makeTask({ id: "t-2", featureId: "f-2" })]),
    ];
    const { nodes } = buildNodesAndEdges(features, "ws", noop);
    const groupNodes = nodes.filter((n) => n.type === "featureGroup");
    expect(groupNodes).toHaveLength(2);
    expect(groupNodes.map((n) => n.id)).toEqual(["f-1", "f-2"]);
  });

  it("creates child task nodes with correct parentId and extent", () => {
    const task = makeTask({ id: "t-1", featureId: "f-1" });
    const features = [makeFeature("f-1", [task])];
    const { nodes } = buildNodesAndEdges(features, "ws", noop);

    const taskNode = nodes.find((n) => n.id === "t-1");
    expect(taskNode).toBeDefined();
    expect(taskNode?.parentId).toBe("f-1");
    expect(taskNode?.extent).toBe("parent");
    expect(taskNode?.type).toBe("taskNode");
  });

  it("handles features with no tasks (empty group)", () => {
    const features = [makeFeature("f-1", [])];
    const { nodes } = buildNodesAndEdges(features, "ws", noop);
    const groupNode = nodes.find((n) => n.id === "f-1");
    expect(groupNode).toBeDefined();
    expect(nodes.filter((n) => n.type === "taskNode")).toHaveLength(0);
  });

  it("sets featureGroup node data with correct fields", () => {
    const features = [makeFeature("f-1", [makeTask({ id: "t-1", featureId: "f-1" })])];
    const { nodes } = buildNodesAndEdges(features, "test-slug", noop);
    const groupNode = nodes.find((n) => n.type === "featureGroup");
    expect(groupNode?.data.featureId).toBe("f-1");
    expect(groupNode?.data.title).toBe("Feature f-1");
    expect(groupNode?.data.slug).toBe("test-slug");
    expect(groupNode?.data.taskCount).toBe(1);
  });

  it("lays out feature groups horizontally (each group x > previous group x)", () => {
    const f1 = makeFeature("f-1", [makeTask({ id: "t-1", featureId: "f-1" })]);
    const f2 = makeFeature("f-2", [makeTask({ id: "t-2", featureId: "f-2" })]);
    const { nodes } = buildNodesAndEdges([f1, f2], "ws", noop);
    const g1 = nodes.find((n) => n.id === "f-1");
    const g2 = nodes.find((n) => n.id === "f-2");
    expect(g1!.position.x).toBe(0);
    expect(g2!.position.x).toBeGreaterThan(0);
  });
});

describe("BoardCanvas — edge derivation", () => {
  const noop = () => {};

  it("creates edges from within-feature dependsOnTaskIds", () => {
    const tasks = [
      makeTask({ id: "t-1", featureId: "f-1", dependsOnTaskIds: [] }),
      makeTask({ id: "t-2", featureId: "f-1", dependsOnTaskIds: ["t-1"] }),
    ];
    const features = [makeFeature("f-1", tasks)];
    const { edges } = buildNodesAndEdges(features, "ws", noop);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("t-1");
    expect(edges[0].target).toBe("t-2");
  });

  it("does NOT create edges for tasks in different features (no cross-feature edges)", () => {
    const task1 = makeTask({ id: "t-1", featureId: "f-1", dependsOnTaskIds: [] });
    // t-2 is in f-2 but lists t-1 (from f-1) as a dep — should be ignored
    const task2 = makeTask({ id: "t-2", featureId: "f-2", dependsOnTaskIds: ["t-1"] });
    const features = [makeFeature("f-1", [task1]), makeFeature("f-2", [task2])];
    const { edges } = buildNodesAndEdges(features, "ws", noop);
    expect(edges).toHaveLength(0);
  });

  it("filters out stale dependency references (dep ID not in this feature)", () => {
    const task = makeTask({
      id: "t-2",
      featureId: "f-1",
      dependsOnTaskIds: ["nonexistent-task"],
    });
    const features = [makeFeature("f-1", [task])];
    const { edges } = buildNodesAndEdges(features, "ws", noop);
    expect(edges).toHaveLength(0);
  });

  it("creates multiple edges within a feature correctly", () => {
    const tasks = [
      makeTask({ id: "t-1", featureId: "f-1", dependsOnTaskIds: [] }),
      makeTask({ id: "t-2", featureId: "f-1", dependsOnTaskIds: ["t-1"] }),
      makeTask({ id: "t-3", featureId: "f-1", dependsOnTaskIds: ["t-2"] }),
    ];
    const features = [makeFeature("f-1", tasks)];
    const { edges } = buildNodesAndEdges(features, "ws", noop);
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => `${e.source}->${e.target}`)).toEqual(
      expect.arrayContaining(["t-1->t-2", "t-2->t-3"]),
    );
  });

  it("uses smoothstep edge type with correct style", () => {
    const tasks = [
      makeTask({ id: "t-1", featureId: "f-1" }),
      makeTask({ id: "t-2", featureId: "f-1", dependsOnTaskIds: ["t-1"] }),
    ];
    const { edges } = buildNodesAndEdges([makeFeature("f-1", tasks)], "ws", noop);
    expect(edges[0].type).toBe("smoothstep");
    expect(edges[0].animated).toBe(true);
    expect((edges[0] as any).style?.stroke).toBe("#3b82f6");
  });

  it("keeps edges isolated per feature (two features with internal deps)", () => {
    const f1tasks = [
      makeTask({ id: "a-1", featureId: "f-1" }),
      makeTask({ id: "a-2", featureId: "f-1", dependsOnTaskIds: ["a-1"] }),
    ];
    const f2tasks = [
      makeTask({ id: "b-1", featureId: "f-2" }),
      makeTask({ id: "b-2", featureId: "f-2", dependsOnTaskIds: ["b-1"] }),
    ];
    const { edges } = buildNodesAndEdges(
      [makeFeature("f-1", f1tasks), makeFeature("f-2", f2tasks)],
      "ws",
      noop,
    );
    expect(edges).toHaveLength(2);
    const sources = edges.map((e) => e.source);
    expect(sources).toContain("a-1");
    expect(sources).toContain("b-1");
  });
});

describe("BoardCanvas — render", () => {
  it("renders the board canvas wrapper", () => {
    const features = [makeFeature("f-1", [makeTask({ id: "t-1", featureId: "f-1" })])];
    render(<BoardCanvas features={features} slug="test-ws" />);
    expect(screen.getByTestId("board-canvas")).toBeTruthy();
  });

  it("renders ReactFlow", () => {
    const features = [makeFeature("f-1", [])];
    render(<BoardCanvas features={features} slug="test-ws" />);
    expect(screen.getByTestId("react-flow")).toBeTruthy();
  });
});
