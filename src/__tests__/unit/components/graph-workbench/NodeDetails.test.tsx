import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkbenchNode } from "@/components/graph-workbench/model";
import { workspaceRoleQuery } from "@/components/graph-workbench/queries";
import type { WorkspaceRole } from "@/lib/auth/roles";

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

/** Saves succeed; every other read stays in flight. */
const fetchMock = vi.fn((url: string) =>
  url.endsWith("/docs") ? Promise.resolve({ ok: true, json: async () => ({ success: true }) }) : new Promise(() => {}),
);

/** `role` seeds the caller's workspace role; leave it out to keep it loading. `host` adds what a host supplies. */
function renderDetails(n: WorkbenchNode, role?: WorkspaceRole, host: Record<string, unknown> = {}) {
  mockUseWorkbench.mockReturnValue({
    slug: "ws",
    graph: {
      lens: { type: "Concept", edge: "PARENT_OF" },
      nodes: { [n.id]: n },
      parents: {},
      children: {},
      edgeTypes: [],
    },
    pending: { links: [], unlinks: [] },
    select: vi.fn(),
    ...host,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (role) client.setQueryData(workspaceRoleQuery("ws").queryKey, role);
  return render(
    <QueryClientProvider client={client}>
      <NodeDetails id={n.id} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("NodeDetails docs editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("shows the edit button for a Concept with no gitree key", () => {
    renderDetails(node({ key: null }), "DEVELOPER");

    expect(screen.getByTestId("graph-workbench-edit-docs")).toBeInTheDocument();
  });

  test("hides the edit button below DEVELOPER", () => {
    renderDetails(node(), "VIEWER");

    expect(screen.queryByTestId("graph-workbench-edit-docs")).not.toBeInTheDocument();
  });

  test("hides the edit button until the role is known", () => {
    renderDetails(node());

    expect(screen.queryByTestId("graph-workbench-edit-docs")).not.toBeInTheDocument();
  });

  test("hides the edit button for non-Concept nodes", () => {
    renderDetails(node({ type: "File" }), "DEVELOPER");

    expect(screen.queryByTestId("graph-workbench-edit-docs")).not.toBeInTheDocument();
  });

  test("hides the edit button for proposed Concepts", () => {
    renderDetails(node({ proposed: "new" }), "DEVELOPER");

    expect(screen.queryByTestId("graph-workbench-edit-docs")).not.toBeInTheDocument();
  });

  test("saves the docs to the node's ref_id", async () => {
    renderDetails(node(), "DEVELOPER");

    fireEvent.click(screen.getByTestId("graph-workbench-edit-docs"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New docs" } });
    fireEvent.click(screen.getByTestId("graph-workbench-save-docs"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws/graph/node/ref-1/docs",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ docs: "New docs" }) }),
      ),
    );
  });
});

describe("NodeDetails share", () => {
  const writeText = vi.fn(async () => {});
  const nodeLink = vi.fn(
    ({ id, type }: { id: string; type: string }) => `https://hive.test/org/o?view=graph&type=${type}&ref_id=${id}`,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("copies the host's link to the node where there's no share sheet", async () => {
    renderDetails(node(), "DEVELOPER", { nodeLink });

    fireEvent.click(screen.getByTestId("graph-workbench-share"));

    expect(nodeLink).toHaveBeenCalledWith({ id: "ref-1", type: "Concept" });
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://hive.test/org/o?view=graph&type=Concept&ref_id=ref-1"),
    );
  });

  test("has nothing to share without a link from the host, or for a node a proposal would create", () => {
    const { unmount } = renderDetails(node(), "DEVELOPER");
    expect(screen.queryByTestId("graph-workbench-share")).toBeNull();
    unmount();

    renderDetails(node({ proposed: "new" }), "DEVELOPER", { nodeLink });
    expect(screen.queryByTestId("graph-workbench-share")).toBeNull();
  });
});
