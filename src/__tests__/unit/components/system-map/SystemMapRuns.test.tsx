/**
 * Render tests for `SystemMapRuns` in its compact form (the CWE lists tab):
 * no Run button, the newest runs collapsed with their status and scope,
 * the rest behind "Show all", and a `refreshKey` bump re-reads the runs.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SystemMapRuns } from "@/components/system-map/SystemMapRuns";
import type { SystemMapRun } from "@/types/system-map";

vi.mock("@/hooks/useWorkspace", () => ({ useWorkspace: () => ({ workspace: { slug: "acme" } }) }));
vi.mock("@/hooks/useWorkspaceAccess", () => ({ useWorkspaceAccess: () => ({ canWrite: true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function run(id: string, overrides: Partial<SystemMapRun> = {}): SystemMapRun {
  return {
    id,
    workflow: "swarm-systemmap-cwe-check-templates",
    strutRunId: `s-${id}`,
    status: "SUCCESS",
    output: { summary: "done" },
    error: null,
    durationMs: 65_000,
    createdAt: "2026-10-20T10:00:00Z",
    settledAt: "2026-10-20T10:01:05Z",
    strutUrl: `/org/acme/strut?run=${id}`,
    cweIds: ["CWE-79"],
    components: null,
    findingRefIds: null,
    apply: null,
    ...overrides,
  };
}

const fetchMock = vi.fn();

function respond(runs: SystemMapRun[]) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ key: "cwe_check", workflow: "swarm-systemmap-cwe-check-templates", runs }),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("SystemMapRuns (compact)", () => {
  it("lists the newest runs collapsed with status and CWEs, without a Run button", async () => {
    respond([run("a", { status: "PENDING", settledAt: null, durationMs: null }), run("b", { status: "ERROR" })]);
    render(<SystemMapRuns workflowKey="cwe_check" compact />);

    expect(await screen.findAllByTestId("system-map-run")).toHaveLength(2);
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getAllByTestId("system-map-run-cwes")[0]).toHaveTextContent("CWE-79");
    expect(screen.queryByTestId("system-map-run-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("system-map-run-report")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/acme/system-map/runs?workflow=cwe_check", expect.anything());
  });

  it("shows three runs, the rest behind Show all", async () => {
    respond(["a", "b", "c", "d", "e"].map((id) => run(id)));
    render(<SystemMapRuns workflowKey="cwe_check" compact />);

    expect(await screen.findAllByTestId("system-map-run")).toHaveLength(3);
    fireEvent.click(screen.getByText("Show all 5"));
    expect(screen.getAllByTestId("system-map-run")).toHaveLength(5);
  });

  it("says so when there are no runs, and re-reads when refreshKey changes", async () => {
    respond([]);
    const { rerender } = render(<SystemMapRuns workflowKey="cwe_check" compact refreshKey={0} />);
    expect(await screen.findByTestId("system-map-runs-empty")).toBeInTheDocument();

    respond([run("new", { status: "PENDING", settledAt: null })]);
    rerender(<SystemMapRuns workflowKey="cwe_check" compact refreshKey={1} />);
    await waitFor(() => expect(screen.getAllByTestId("system-map-run")).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
