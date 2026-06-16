// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
