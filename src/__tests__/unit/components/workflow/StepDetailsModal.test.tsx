// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StepDetailsModal } from "@/components/StepDetailsModal";
import type { WorkflowTransition } from "@/types/stakwork/workflow";

// Mock FlagEvalStepModal to avoid deep rendering in unit tests
vi.mock("@/components/evals/FlagEvalStepModal", () => ({
  FlagEvalStepModal: ({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) =>
    open ? (
      <div data-testid="flag-eval-modal">
        <button onClick={() => onOpenChange(false)}>Close flag modal</button>
      </div>
    ) : null,
}));

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

// ── Flag-for-eval button visibility ──────────────────────────────────────────

const LLM_RUN_TRANSITION = {
  id: "openai_step",
  name: "openai_step",
  url: "https://api.openai.com/v1/chat/completions",
  method: "POST",
  output: {
    response: {
      choices: [
        {
          message: { content: "Hello world" },
          finish_reason: "stop",
        },
      ],
    },
  },
  attributes: {
    raw_input_params: {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say hello" }],
    },
  },
};

const NON_LLM_RUN_TRANSITION = {
  id: "set_var_step",
  name: "set_var_step",
  // No LLM provider URL
  attributes: {
    vars: { foo: "bar" },
  },
};

const evalCtx = { slug: "test-ws", workflowId: "42", runId: "9999" };

describe("StepDetailsModal — Flag for eval button", () => {
  it("shows 'Flag for eval' button for an LLM step when evalContext and run are present", () => {
    const llmStep = makeStep({ id: "openai_step", name: "openai_step" });
    render(
      <StepDetailsModal
        step={llmStep}
        isOpen={true}
        onClose={vi.fn()}
        runTransitions={{ openai_step: LLM_RUN_TRANSITION as unknown as WorkflowTransition }}
        evalContext={evalCtx}
      />,
    );
    expect(screen.getByText("Flag for eval")).toBeDefined();
  });

  it("does NOT show 'Flag for eval' button for a non-LLM step", () => {
    const nonLlmStep = makeStep({ id: "set_var_step", name: "set_var_step" });
    render(
      <StepDetailsModal
        step={nonLlmStep}
        isOpen={true}
        onClose={vi.fn()}
        runTransitions={{ set_var_step: NON_LLM_RUN_TRANSITION as unknown as WorkflowTransition }}
        evalContext={evalCtx}
      />,
    );
    expect(screen.queryByText("Flag for eval")).toBeNull();
  });

  it("does NOT show 'Flag for eval' button when evalContext is missing", () => {
    const llmStep = makeStep({ id: "openai_step", name: "openai_step" });
    render(
      <StepDetailsModal
        step={llmStep}
        isOpen={true}
        onClose={vi.fn()}
        runTransitions={{ openai_step: LLM_RUN_TRANSITION as unknown as WorkflowTransition }}
        // no evalContext
      />,
    );
    expect(screen.queryByText("Flag for eval")).toBeNull();
  });

  it("does NOT show 'Flag for eval' button when no run is active (runTransitions undefined)", () => {
    const llmStep = makeStep({ id: "openai_step", name: "openai_step" });
    render(
      <StepDetailsModal
        step={llmStep}
        isOpen={true}
        onClose={vi.fn()}
        // runTransitions not provided
        evalContext={evalCtx}
      />,
    );
    expect(screen.queryByText("Flag for eval")).toBeNull();
  });

  it("opens the FlagEvalStepModal when 'Flag for eval' is clicked", () => {
    const llmStep = makeStep({ id: "openai_step", name: "openai_step" });
    render(
      <StepDetailsModal
        step={llmStep}
        isOpen={true}
        onClose={vi.fn()}
        runTransitions={{ openai_step: LLM_RUN_TRANSITION as unknown as WorkflowTransition }}
        evalContext={evalCtx}
      />,
    );

    const flagBtn = screen.getByText("Flag for eval");
    fireEvent.click(flagBtn);

    // The mocked FlagEvalStepModal should now be visible
    expect(screen.getByTestId("flag-eval-modal")).toBeDefined();
  });
});
