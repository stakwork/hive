import React from "react";
import { describe, test, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const mockSetNodes = vi.fn();
const mockSetEdges = vi.fn();

// Mock @xyflow/react — avoid JSX inside mock factories (no React auto-import)
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: any) =>
    React.createElement("div", { "data-testid": "react-flow" }, children),
  ReactFlowProvider: ({ children }: any) =>
    React.createElement(React.Fragment, null, children),
  useNodesState: (initial: any) => [initial, mockSetNodes, vi.fn()],
  useEdgesState: (initial: any) => [initial, mockSetEdges, vi.fn()],
  useReactFlow: () => ({ fitView: vi.fn() }),
  Controls: () => React.createElement("div", { "data-testid": "controls" }),
  Background: () => React.createElement("div", { "data-testid": "background" }),
  BackgroundVariant: { Dots: "dots" },
}));

vi.mock("@/components/features/DependencyGraph/layouts/dagre", () => ({
  getLayoutedElements: (nodes: any, edges: any) => ({ nodes, edges }),
}));

vi.mock("@/components/ui/empty", () => ({
  Empty: ({ children, className }: any) =>
    React.createElement("div", { "data-testid": "empty", className }, children),
  EmptyHeader: ({ children }: any) => React.createElement("div", null, children),
  EmptyTitle: ({ children }: any) => React.createElement("div", null, children),
  EmptyDescription: ({ children }: any) => React.createElement("div", null, children),
}));

import { DependencyGraph } from "@/components/features/DependencyGraph";

const makeEntity = (id: string, deps: string[] = []) => ({ id, title: id, deps });

describe("DependencyGraph", () => {
  test("applies className prop to the outer wrapper div", () => {
    const entities = [makeEntity("a"), makeEntity("b", ["a"])];

    const { container } = render(
      React.createElement(DependencyGraph, {
        entities,
        getDependencies: (e: any) => e.deps,
        renderNode: (e: any) => React.createElement("span", null, e.title),
        className: "h-[280px] custom-class",
      })
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("h-[280px]");
    expect(wrapper.className).toContain("custom-class");
  });

  test("outer wrapper div has default h-[600px] when no className is passed", () => {
    const entities = [makeEntity("a"), makeEntity("b", ["a"])];

    const { container } = render(
      React.createElement(DependencyGraph, {
        entities,
        getDependencies: (e: any) => e.deps,
        renderNode: (e: any) => React.createElement("span", null, e.title),
      })
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("h-[600px]");
  });

  test("className overrides the default h-[600px] height via twMerge", () => {
    const entities = [makeEntity("a"), makeEntity("b", ["a"])];

    const { container } = render(
      React.createElement(DependencyGraph, {
        entities,
        getDependencies: (e: any) => e.deps,
        renderNode: (e: any) => React.createElement("span", null, e.title),
        className: "h-[380px]",
      })
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("h-[380px]");
    // twMerge should drop the conflicting h-[600px]
    expect(wrapper.className).not.toContain("h-[600px]");
  });
});

describe("DependencyGraph — node/edge re-sync on entity changes", () => {
  test("calls setNodes and setEdges when entities prop changes", () => {
    mockSetNodes.mockClear();
    mockSetEdges.mockClear();

    const entities = [makeEntity("a"), makeEntity("b", ["a"])];

    const { rerender } = render(
      React.createElement(DependencyGraph, {
        entities,
        getDependencies: (e: any) => e.deps,
        renderNode: (e: any) => React.createElement("span", null, e.title),
      })
    );

    // Baseline: setNodes/setEdges called on mount (from useEffect)
    const initialSetNodesCalls = mockSetNodes.mock.calls.length;
    const initialSetEdgesCalls = mockSetEdges.mock.calls.length;

    // Update entities (simulates a status change / new task arriving)
    const updatedEntities = [
      makeEntity("a"),
      makeEntity("b", ["a"]),
      makeEntity("c", ["b"]),
    ];

    rerender(
      React.createElement(DependencyGraph, {
        entities: updatedEntities,
        getDependencies: (e: any) => e.deps,
        renderNode: (e: any) => React.createElement("span", null, e.title),
      })
    );

    // setNodes and setEdges must each be called at least once more after the rerender
    expect(mockSetNodes.mock.calls.length).toBeGreaterThan(initialSetNodesCalls);
    expect(mockSetEdges.mock.calls.length).toBeGreaterThan(initialSetEdgesCalls);

    // The last call to setNodes should include the new entity "c"
    const lastSetNodesArg = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
    const nodeIds = lastSetNodesArg.map((n: any) => n.id);
    expect(nodeIds).toContain("c");
  });

  test("calls setNodes with updated node data when entity status changes", () => {
    mockSetNodes.mockClear();
    mockSetEdges.mockClear();

    const entities = [
      { id: "task-1", title: "Task 1", status: "TODO", deps: [] },
      { id: "task-2", title: "Task 2", status: "TODO", deps: ["task-1"] },
    ];

    const { rerender } = render(
      React.createElement(DependencyGraph, {
        entities,
        getDependencies: (e: any) => e.deps,
        renderNode: (e: any) => React.createElement("span", null, e.title),
      })
    );

    mockSetNodes.mockClear();

    // Simulate status update on task-1
    const updatedEntities = [
      { id: "task-1", title: "Task 1", status: "IN_PROGRESS", deps: [] },
      { id: "task-2", title: "Task 2", status: "TODO", deps: ["task-1"] },
    ];

    rerender(
      React.createElement(DependencyGraph, {
        entities: updatedEntities,
        getDependencies: (e: any) => e.deps,
        renderNode: (e: any) => React.createElement("span", null, e.title),
      })
    );

    expect(mockSetNodes).toHaveBeenCalled();
    const lastCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1][0];
    const task1Node = lastCall.find((n: any) => n.id === "task-1");
    expect(task1Node).toBeDefined();
    expect(task1Node.data.status).toBe("IN_PROGRESS");
  });
});
