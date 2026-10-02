import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkbenchNode } from "@/components/graph-workbench/model";

const { mockUseWorkbench } = vi.hoisted(() => ({ mockUseWorkbench: vi.fn() }));
vi.mock("@/components/graph-workbench/store", () => ({
  useWorkbench: () => mockUseWorkbench(),
}));

vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { NodeDetails } from "@/components/graph-workbench/NodeDetails";

const node = (extra: Partial<WorkbenchNode> = {}): WorkbenchNode => ({
  id: "ref-1",
  key: null,
  name: "Concept One",
  type: "Concept",
  description: null,
  docs: "# Some docs\n\nEnough words to count as documented content here.",
  repo: null,
  reads: 0,
  approvers: [],
  root: false,
  ...extra,
});

function renderDetails(n: WorkbenchNode) {
  mockUseWorkbench.mockReturnValue({
    slug: "ws",
    graph: { lens: { type: "Concept", edge: "PARENT_OF" }, nodes: { [n.id]: n }, parents: {}, children: {}, edgeTypes: [] },
    pending: { links: [] },
    select: vi.fn(),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  return render(
    <QueryClientProvider client={client}>
      <NodeDetails id={n.id} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("NodeDetails docs editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("shows the edit button for a Concept with no gitree key", () => {
    renderDetails(node({ key: null }));

    expect(screen.getByTestId("graph-workbench-edit-docs")).toBeInTheDocument();
  });

  test("hides the edit button for non-Concept nodes", () => {
    renderDetails(node({ type: "File" }));

    expect(screen.queryByTestId("graph-workbench-edit-docs")).not.toBeInTheDocument();
  });

  test("hides the edit button for proposed Concepts", () => {
    renderDetails(node({ proposed: "new" }));

    expect(screen.queryByTestId("graph-workbench-edit-docs")).not.toBeInTheDocument();
  });
});
