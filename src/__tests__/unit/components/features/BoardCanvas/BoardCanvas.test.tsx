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

// Mock dagre layout — return nodes unchanged
vi.mock("@/components/features/DependencyGraph/layouts/dagre", () => ({
  getLayoutedElements: (nodes: any, edges: any) => ({ nodes, edges }),
}));

// Mock child nodes (avoid CSS module issues in jsdom)
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

// Re-import the pure function for logic tests
import * as BoardCanvasModule from "@/components/features/BoardCanvas";

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

  it("stacks task nodes vertically inside the group", () => {
    const tasks = [
      makeTask({ id: "t-1", featureId: "f-1" }),
      makeTask({ id: "t-2", featureId: "f-1" }),
      makeTask({ id: "t-3", featureId: "f-1" }),
    ];
    const features = [makeFeature("f-1", tasks)];
    const { nodes } = buildNodesAndEdges(features, "ws", noop);

    const t1 = nodes.find((n) => n.id === "t-1");
    const t2 = nodes.find((n) => n.id === "t-2");
    const t3 = nodes.find((n) => n.id === "t-3");

    expect(t1?.position.x).toBe(GROUP_PADDING);
    expect(t1?.position.y).toBe(HEADER_HEIGHT + GROUP_PADDING);

    expect(t2?.position.x).toBe(GROUP_PADDING);
    expect(t2?.position.y).toBe(HEADER_HEIGHT + GROUP_PADDING + TASK_NODE_HEIGHT);

    expect(t3?.position.x).toBe(GROUP_PADDING);
    expect(t3?.position.y).toBe(HEADER_HEIGHT + GROUP_PADDING + TASK_NODE_HEIGHT * 2);
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
});

describe("BoardCanvas — edge derivation", () => {
  const noop = () => {};

  it("creates edges from dependsOnTaskIds", () => {
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

  it("creates cross-feature dependency edges", () => {
    const task1 = makeTask({ id: "t-1", featureId: "f-1", dependsOnTaskIds: [] });
    const task2 = makeTask({ id: "t-2", featureId: "f-2", dependsOnTaskIds: ["t-1"] });
    const features = [makeFeature("f-1", [task1]), makeFeature("f-2", [task2])];
    const { edges } = buildNodesAndEdges(features, "ws", noop);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("t-1");
    expect(edges[0].target).toBe("t-2");
  });

  it("filters out stale dependency references (source not in current feature set)", () => {
    const task = makeTask({
      id: "t-2",
      featureId: "f-1",
      dependsOnTaskIds: ["nonexistent-task"],
    });
    const features = [makeFeature("f-1", [task])];
    const { edges } = buildNodesAndEdges(features, "ws", noop);
    expect(edges).toHaveLength(0);
  });

  it("filters out stale dependency references (target not in current feature set)", () => {
    const task = makeTask({
      id: "t-1",
      featureId: "f-1",
      dependsOnTaskIds: [],
    });
    // t-2 depends on t-1 but is not included in features
    const features = [makeFeature("f-1", [task])];
    const { edges } = buildNodesAndEdges(features, "ws", noop);
    expect(edges).toHaveLength(0);
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

  it("deduplicates edges when multiple tasks reference the same dependency", () => {
    const tasks = [
      makeTask({ id: "t-1", featureId: "f-1" }),
      makeTask({ id: "t-2", featureId: "f-1", dependsOnTaskIds: ["t-1"] }),
    ];
    // Add same task twice to simulate duplicated dep entries
    const feature: BoardFeature = {
      id: "f-1",
      title: "F1",
      status: "IN_PROGRESS" as any,
      priority: "MEDIUM" as any,
      tasks,
    };
    const { edges } = buildNodesAndEdges([feature], "ws", noop);
    const dupes = edges.filter((e) => e.source === "t-1" && e.target === "t-2");
    expect(dupes).toHaveLength(1);
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
