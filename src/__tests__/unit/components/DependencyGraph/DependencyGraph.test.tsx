import React from "react";
import { describe, test, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// Mock @xyflow/react — avoid JSX inside mock factories (no React auto-import)
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: any) =>
    React.createElement("div", { "data-testid": "react-flow" }, children),
  useNodesState: (initial: any) => [initial, vi.fn(), vi.fn()],
  useEdgesState: (initial: any) => [initial, vi.fn(), vi.fn()],
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
