import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkbenchProvider, useWorkbench } from "@/components/graph-workbench/store";
import type { Hierarchy } from "@/services/graph/workbench";

/**
 *   glimmer ── coding ── security   (the only tree; "loose" has no parent or children either)
 *   loose
 */
const hierarchy: Hierarchy = {
  nodes: [
    { id: "glimmer", key: null, name: "Glimmer", description: null, docs: null, repo: null, reads: 0, approvers: [] },
    { id: "coding", key: null, name: "Coding", description: null, docs: null, repo: null, reads: 0, approvers: [] },
    { id: "security", key: null, name: "Security", description: null, docs: null, repo: null, reads: 0, approvers: [] },
  ],
  edges: [
    { type: "PARENT_OF", source: "glimmer", target: "coding" },
    { type: "PARENT_OF", source: "coding", target: "security" },
  ],
  truncated: false,
};

const fetchMock = vi.fn((url: string) => {
  if (url.includes("/graph/hierarchy")) {
    return Promise.resolve({ ok: true, json: async () => hierarchy });
  }
  return Promise.reject(new Error(`unexpected fetch: ${url}`));
});

/** Surfaces the workbench state as text, so tests can assert on it without touching the canvas. */
function Probe() {
  const { selectedId, canvasMode, rootId, loading } = useWorkbench();
  if (loading) return <div>loading</div>;
  return (
    <div>
      <div data-testid="selected">{selectedId ?? "none"}</div>
      <div data-testid="mode">{canvasMode}</div>
      <div data-testid="root">{rootId ?? "none"}</div>
    </div>
  );
}

function renderWorkbench(initialFocusId?: string | readonly string[] | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkbenchProvider slug="ws" initialFocusId={initialFocusId}>
        <Probe />
      </WorkbenchProvider>
    </QueryClientProvider>,
  );
}

describe("WorkbenchProvider deep-link landing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockClear();
  });

  test("a Concept id in the loaded tree is focused in tree mode", async () => {
    renderWorkbench("coding");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("coding"));
    expect(screen.getByTestId("mode")).toHaveTextContent("tree");
  });

  test("an id outside the loaded tree (e.g. a Claim) selects by ref_id and switches to graph mode", async () => {
    renderWorkbench("claim-1");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("claim-1"));
    // GraphCanvas (not rendered here) is what reads connectionsQuery for the selected id;
    // the store's job is just to select it and switch the canvas mode to fetch it by ref_id.
    expect(screen.getByTestId("mode")).toHaveTextContent("graph");
  });

  test("no initialFocusId lands on the biggest tree", async () => {
    renderWorkbench(undefined);

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("glimmer"));
    expect(screen.getByTestId("mode")).toHaveTextContent("tree");
    expect(screen.getByTestId("root")).toHaveTextContent("glimmer");
  });
});
