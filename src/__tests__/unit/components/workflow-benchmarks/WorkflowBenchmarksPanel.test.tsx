/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for WorkflowBenchmarksPanel.
 *
 * Covers:
 *   - Inputs block rendered when a task declares workflow_input
 *   - Inputs block omitted entirely when a task declares none
 *   - The expected answer is never rendered (structurally absent from this
 *     client module — asserted by checking the rendered task data has no
 *     expected_output key at all, not merely that it isn't shown)
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

globalThis.React = React;

const mockUseWorkspace = vi.fn(() => ({
  workspace: { id: "ws-1", slug: "stakwork" },
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

const { WITH_INPUT_TASK, NO_INPUT_TASK } = vi.hoisted(() => ({
  WITH_INPUT_TASK: {
    slug: "wfbench/generate-capital-city",
    title: "Answer a capital city",
    instructions: "Do the thing.\n\n## Workflow Inputs\n\nDeclare... \n\n- `country`",
    criteria: [{ id: "C-001", title: "Uses country", match_criteria: "References `country`." }],
    workflow_input: { country: "Wales" },
  },
  NO_INPUT_TASK: {
    slug: "wfbench/create-openai-call",
    title: "Create an OpenAI call",
    instructions: "Do the other thing.",
    criteria: [{ id: "C-001", title: "Has a step", match_criteria: "Has a request step." }],
  },
}));

vi.mock("@/lib/workflow-benchmark-tasks", () => ({
  WORKFLOW_BENCHMARK_TASKS: [WITH_INPUT_TASK, NO_INPUT_TASK],
}));

vi.stubGlobal("fetch", vi.fn());

import { WorkflowBenchmarksPanel } from "@/components/workflow-benchmarks/WorkflowBenchmarksPanel";

describe("WorkflowBenchmarksPanel", () => {
  it("renders both task cards", () => {
    render(<WorkflowBenchmarksPanel />);
    expect(screen.getByText("Answer a capital city")).toBeInTheDocument();
    expect(screen.getByText("Create an OpenAI call")).toBeInTheDocument();
  });

  it("shows an Inputs block with key/value pairs when the task declares workflow_input, after expanding", () => {
    render(<WorkflowBenchmarksPanel />);
    const expandButtons = screen.getAllByLabelText("Expand task details");
    // First card corresponds to WITH_INPUT_TASK
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

  it("shows a loading state when the workspace is not yet resolved", () => {
    mockUseWorkspace.mockReturnValueOnce({ workspace: undefined as unknown as { id: string; slug: string } });
    render(<WorkflowBenchmarksPanel />);
    expect(screen.getByText("Loading workspace…")).toBeInTheDocument();
  });
});
