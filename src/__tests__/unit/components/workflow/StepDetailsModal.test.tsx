// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepDetailsModal } from "@/components/StepDetailsModal";
import type { WorkflowTransition } from "@/types/stakwork/workflow";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<WorkflowTransition> = {}): WorkflowTransition {
  return {
    id: "step-1",
    name: "my_step",
    display_name: "My Step",
    display_id: "step-1",
    step_type: "automated",
    ...overrides,
  } as WorkflowTransition;
}

// ── StepDetailsModal render ───────────────────────────────────────────────────

describe("StepDetailsModal — overlay and sizing", () => {
  it("uses fixed positioning for the overlay", () => {
    const { container } = render(
      <StepDetailsModal
        step={makeStep()}
        isOpen={true}
        onClose={vi.fn()}
      />,
    );
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.className).toContain("fixed");
    expect(overlay.className).not.toContain("absolute");
  });

  it("applies w-[75vw] and max-h-[90vh] to the inner dialog", () => {
    const { container } = render(
      <StepDetailsModal
        step={makeStep()}
        isOpen={true}
        onClose={vi.fn()}
      />,
    );
    const overlay = container.firstChild as HTMLElement;
    const dialog = overlay.firstChild as HTMLElement;
    expect(dialog.className).toContain("w-[75vw]");
    expect(dialog.className).toContain("max-h-[90vh]");
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <StepDetailsModal
        step={makeStep()}
        isOpen={false}
        onClose={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when step is null", () => {
    const { container } = render(
      <StepDetailsModal
        step={null}
        isOpen={true}
        onClose={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("displays the step display_name in the header", () => {
    render(
      <StepDetailsModal
        step={makeStep({ display_name: "Deploy Service" })}
        isOpen={true}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Deploy Service")).toBeDefined();
  });
});

// ── Tab switching does not close the modal ────────────────────────────────────

describe("StepDetailsModal — tab clicks do not close the modal", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: null }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("does not call onClose when clicking the Inputs tab", async () => {
    const onClose = vi.fn();
    render(<StepDetailsModal step={makeStep()} isOpen={true} onClose={onClose} />);

    await userEvent.click(screen.getByRole("tab", { name: "Inputs" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onClose when clicking the Outputs tab", async () => {
    const onClose = vi.fn();
    render(<StepDetailsModal step={makeStep()} isOpen={true} onClose={onClose} />);

    await userEvent.click(screen.getByRole("tab", { name: "Outputs" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onClose when clicking the Logs tab", async () => {
    const onClose = vi.fn();
    render(<StepDetailsModal step={makeStep()} isOpen={true} onClose={onClose} />);

    await userEvent.click(screen.getByRole("tab", { name: "Logs" }));

    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── IO endpoint fetching ──────────────────────────────────────────────────────

describe("StepDetailsModal — IO endpoint", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({ data: { inputs: { foo: "bar" }, outputs: { baz: "qux" } } }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("fetches IO using step.name when run transitions have no project_step_id", async () => {
    render(
      <StepDetailsModal
        step={makeStep({ id: "step-1", name: "my_step" })}
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-1"
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/proj-1/steps/my_step/io",
      );
    });
  });

  it("fetches IO using runStep.project_step_id when provided in run transitions", async () => {
    const runTransitions: Record<string, WorkflowTransition> = {
      "step-1": makeStep({ id: "step-1", name: "my_step", project_step_id: "psid-123" }),
    };
    render(
      <StepDetailsModal
        step={makeStep({ id: "step-1", name: "my_step" })}
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-1"
        runTransitions={runTransitions}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/proj-1/steps/psid-123/io",
      );
    });
  });

  it("does not fetch IO when projectId is undefined", async () => {
    render(<StepDetailsModal step={makeStep()} isOpen={true} onClose={vi.fn()} />);

    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── IO tab empty states ───────────────────────────────────────────────────────

describe("StepDetailsModal — IO tab empty states", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows 'Select a run to view IO data.' in Inputs/Outputs when projectId is undefined", async () => {
    render(<StepDetailsModal step={makeStep()} isOpen={true} onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Inputs" }));
    expect(screen.getByText("Select a run to view IO data.")).toBeDefined();

    await userEvent.click(screen.getByRole("tab", { name: "Outputs" }));
    expect(screen.getByText("Select a run to view IO data.")).toBeDefined();
  });

  it("shows 'No input data available.' when projectId is set but ioData is null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => Promise.resolve({ data: null }) }),
    );

    render(
      <StepDetailsModal
        step={makeStep({ name: "my_step" })}
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-1"
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Inputs" }));
    await waitFor(() => {
      expect(screen.getByText("No input data available.")).toBeDefined();
    });
  });
});
