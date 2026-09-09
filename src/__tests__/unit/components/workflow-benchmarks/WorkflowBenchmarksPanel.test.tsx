/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for WorkflowBenchmarksPanel.
 *
 * Covers:
 *   - Section sidebar rendered from the tasks' `section` field, with counts,
 *     first section (alphabetical) auto-selected
 *   - Clicking a section switches the visible task list
 *   - Inputs block rendered when a task declares workflow_input
 *   - Inputs block omitted entirely when a task declares none
 *   - The expected answer is never rendered (structurally absent from this
 *     client module — asserted by checking the rendered task data has no
 *     expected_output key at all, not merely that it isn't shown)
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

globalThis.React = React;

const mockUseWorkspace = vi.fn(() => ({
  workspace: { id: "ws-1", slug: "stakwork" },
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

const { WITH_INPUT_TASK, NO_INPUT_TASK, VISION_TASK } = vi.hoisted(() => ({
  WITH_INPUT_TASK: {
    slug: "wfbench/generate-capital-city",
    section: "llm",
    title: "Answer a capital city",
    instructions: "Do the thing.\n\n## Workflow Inputs\n\nDeclare... \n\n- `country`",
    criteria: [{ id: "C-001", title: "Uses country", match_criteria: "References `country`." }],
    workflow_input: { country: "Wales" },
  },
  NO_INPUT_TASK: {
    slug: "wfbench/create-openai-call",
    section: "llm",
    title: "Create an OpenAI call",
    instructions: "Do the other thing.",
    criteria: [{ id: "C-001", title: "Has a step", match_criteria: "Has a request step." }],
  },
  VISION_TASK: {
    slug: "wfbench/gaia-chess-winning-move",
    section: "vision",
    title: "Choose a chess move",
    instructions: "Read the board.",
    criteria: [{ id: "C-001", title: "Reads image", match_criteria: "Consumes the image." }],
  },
}));

vi.mock("@/lib/workflow-benchmark-tasks", () => ({
  WORKFLOW_BENCHMARK_TASKS: [WITH_INPUT_TASK, NO_INPUT_TASK, VISION_TASK],
}));

vi.stubGlobal("fetch", vi.fn());

import { WorkflowBenchmarksPanel } from "@/components/workflow-benchmarks/WorkflowBenchmarksPanel";

describe("WorkflowBenchmarksPanel", () => {
  it("renders the section sidebar with per-section counts and auto-selects the first section", () => {
    render(<WorkflowBenchmarksPanel />);

    // Sections sorted alphabetically: llm (displayed "LLM") before vision.
    expect(screen.getByRole("button", { name: /LLM/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vision/ })).toBeInTheDocument();

    // First section auto-selected — its two cards visible, vision's not.
    expect(screen.getByText("Answer a capital city")).toBeInTheDocument();
    expect(screen.getByText("Create an OpenAI call")).toBeInTheDocument();
    expect(screen.queryByText("Choose a chess move")).not.toBeInTheDocument();
  });

  it("switches the visible task list when a section is clicked", () => {
    render(<WorkflowBenchmarksPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Vision/ }));

    expect(screen.getByText("Choose a chess move")).toBeInTheDocument();
    expect(screen.queryByText("Answer a capital city")).not.toBeInTheDocument();
    expect(screen.queryByText("Create an OpenAI call")).not.toBeInTheDocument();
  });

  it("shows an Inputs block with key/value pairs when the task declares workflow_input, after expanding", () => {
    render(<WorkflowBenchmarksPanel />);
    const expandButtons = screen.getAllByLabelText("Expand task details");
    // First card in the auto-selected llm section corresponds to WITH_INPUT_TASK
    fireEvent.click(expandButtons[0]);

    expect(screen.getByText("Inputs (read-only)")).toBeInTheDocument();
    expect(screen.getByText(/country:\s*Wales/)).toBeInTheDocument();
  });

  it("omits the Inputs block entirely for a task with no workflow_input", () => {
    render(<WorkflowBenchmarksPanel />);
    const expandButtons = screen.getAllByLabelText("Expand task details");
    // Second card corresponds to NO_INPUT_TASK
    fireEvent.click(expandButtons[1]);

    expect(screen.queryByText("Inputs (read-only)")).not.toBeInTheDocument();
  });

  it("never renders an expected answer — the task data passed to this component structurally has no expected_output field", () => {
    // This is the real enforcement mechanism: the client module only ever
    // imports WORKFLOW_BENCHMARK_TASKS (the index type), which is
    // Omit<WorkflowBenchmarkTaskSource, "expected_output"> — the field simply
    // does not exist on the objects this component can render.
    expect(Object.prototype.hasOwnProperty.call(WITH_INPUT_TASK, "expected_output")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(NO_INPUT_TASK, "expected_output")).toBe(false);

    render(<WorkflowBenchmarksPanel />);
    const expandButtons = screen.getAllByLabelText("Expand task details");
    fireEvent.click(expandButtons[0]);
    expect(screen.queryByText(/Cardiff/)).not.toBeInTheDocument();
  });

  it("runner toggle defaults to Stakwork and the request body is unchanged (no runner key)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ run_id: "run-1" }) } as Response);
    render(<WorkflowBenchmarksPanel />);
    const toggle = screen.getAllByTestId(/^wf-runner-toggle-/)[0];
    expect(within(toggle).getByLabelText("Run on Stakwork")).toHaveAttribute("data-state", "on");
    expect(within(toggle).getByLabelText("Run on strut")).toHaveAttribute("data-state", "off");

    fireEvent.click(screen.getAllByText("Run Benchmark")[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ taskSlug: WITH_INPUT_TASK.slug });
  });

  it("choosing strut sends runner: \"strut\" with the same taskSlug", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ run_id: "run-2", runner: "strut" }) } as Response);
    render(<WorkflowBenchmarksPanel />);
    const toggle = screen.getAllByTestId(/^wf-runner-toggle-/)[0];
    fireEvent.click(within(toggle).getByLabelText("Run on strut"));
    expect(within(toggle).getByLabelText("Run on strut")).toHaveAttribute("data-state", "on");

    fireEvent.click(screen.getAllByText("Run Benchmark")[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/workspaces/stakwork/workflow-benchmarks/run");
    expect(JSON.parse(init.body as string)).toEqual({ taskSlug: WITH_INPUT_TASK.slug, runner: "strut" });
  });

  it("shows a loading state when the workspace is not yet resolved", () => {
    mockUseWorkspace.mockReturnValueOnce({ workspace: undefined as unknown as { id: string; slug: string } });
    render(<WorkflowBenchmarksPanel />);
    expect(screen.getByText("Loading workspace…")).toBeInTheDocument();
  });
});
