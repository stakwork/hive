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

/** `role` seeds the caller's workspace role; leave it out to keep it loading. */
function renderDetails(n: WorkbenchNode, role?: WorkspaceRole) {
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

describe("NodeDetails copy link", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const share = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { clipboard: { writeText }, share });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("always copies a gnode link to the clipboard, never navigator.share", async () => {
    renderDetails(node());

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(new URL(writeText.mock.calls[0][0]).searchParams.get("gnode")).toBe("ref-1");
    expect(share).not.toHaveBeenCalled();
  });
});
