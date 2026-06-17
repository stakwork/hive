// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepDetailsModal } from "@/components/StepDetailsModal";
import type { WorkflowTransition } from "@/types/stakwork/workflow";

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/components/evals/CaptureEvalForm", () => ({
  CaptureEvalForm: ({
    requirement,
    reason,
    onRequirementChange,
    onReasonChange,
    submitting,
  }: {
    requirement: string;
    reason: string;
    onRequirementChange: (v: string) => void;
    onReasonChange: (v: string) => void;
    submitting?: boolean;
  }) => (
    <div data-testid="capture-eval-form">
      <input
        aria-label="Requirement"
        value={requirement}
        onChange={(e) => onRequirementChange(e.target.value)}
        disabled={submitting}
      />
      <input
        aria-label="Reason"
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        disabled={submitting}
      />
    </div>
  ),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a WorkflowTransition that isLlmStep recognises as an LLM step */
function makeLlmStep(overrides: Partial<WorkflowTransition> = {}): WorkflowTransition {
  return {
    id: "step-llm",
    name: "generate_response",
    display_name: "Generate Response",
    display_id: "step-llm",
    step_type: "automated",
    url: "https://api.openai.com/v1/chat/completions",
    ...overrides,
  } as WorkflowTransition;
}

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

function defaultProps(overrides: Partial<React.ComponentProps<typeof StepDetailsModal>> = {}) {
  return {
    step: makeStep(),
    isOpen: true,
    onClose: vi.fn(),
    ...overrides,
  };
}

// ── StepDetailsModal render ───────────────────────────────────────────────────

describe("StepDetailsModal — overlay and sizing", () => {
  it("uses fixed positioning for the overlay", () => {
    const { container } = render(<StepDetailsModal {...defaultProps()} />);
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.className).toContain("fixed");
    expect(overlay.className).not.toContain("absolute");
  });

  it("constrains the inner dialog width and height", () => {
    const { container } = render(<StepDetailsModal {...defaultProps()} />);
    const overlay = container.firstChild as HTMLElement;
    const dialog = overlay.firstChild as HTMLElement;
    expect(dialog.className).toContain("max-w-3xl");
    expect(dialog.className).toContain("max-h-[85vh]");
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <StepDetailsModal {...defaultProps({ isOpen: false })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when step is null", () => {
    const { container } = render(
      <StepDetailsModal {...defaultProps({ step: null })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("displays the step display_name in the header", () => {
    render(
      <StepDetailsModal {...defaultProps({ step: makeStep({ display_name: "Deploy Service" }) })} />,
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

  it("fetches IO using step.id", async () => {
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
        "/api/projects/proj-1/steps/step-1/io",
      );
    });
  });

  it("fetches IO using step.id even when run transitions provide project_step_id", async () => {
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
        "/api/projects/proj-1/steps/step-1/io",
      );
    });
  });

  it("renders IO data when fetch returns { data: { inputs, outputs } }", async () => {
    fetchMock.mockResolvedValue({
      json: () =>
        Promise.resolve({ success: true, data: { inputs: { foo: 1 }, outputs: { bar: 2 } } }),
    });

    render(
      <StepDetailsModal
        step={makeStep({ id: "step-1", name: "my_step" })}
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-1"
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Inputs" }));
    await waitFor(() => {
      expect(screen.getByText(/\"foo\"/)).toBeDefined();
    });

    await userEvent.click(screen.getByRole("tab", { name: "Outputs" }));
    await waitFor(() => {
      expect(screen.getByText(/\"bar\"/)).toBeDefined();
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

// ── Flag for eval button visibility ──────────────────────────────────────────

describe("StepDetailsModal — Flag for eval button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { inputs: { model: "gpt-4o" }, outputs: "result" } }),
    }));
  });

  it("shows Flag for eval when slug, workflowId, projectId are set and step is LLM", () => {
    render(
      <StepDetailsModal
        {...defaultProps({
          step: makeLlmStep(),
          slug: "my-ws",
          workflowId: "42",
          projectId: "run-123",
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /flag for eval/i })).toBeInTheDocument();
  });

  it("hides Flag for eval when projectId is absent (no active run)", () => {
    render(
      <StepDetailsModal
        {...defaultProps({
          step: makeLlmStep(),
          slug: "my-ws",
          workflowId: "42",
          // no projectId
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /flag for eval/i })).not.toBeInTheDocument();
  });

  it("hides Flag for eval for non-LLM step types", () => {
    render(
      <StepDetailsModal
        {...defaultProps({
          step: makeStep(), // no LLM URL
          slug: "my-ws",
          workflowId: "42",
          projectId: "run-123",
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /flag for eval/i })).not.toBeInTheDocument();
  });

  it("hides Flag for eval when slug is absent", () => {
    render(
      <StepDetailsModal
        {...defaultProps({
          step: makeLlmStep(),
          workflowId: "42",
          projectId: "run-123",
          // no slug
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /flag for eval/i })).not.toBeInTheDocument();
  });
});

// ── Flag for eval capture flow ────────────────────────────────────────────────

describe("StepDetailsModal — Flag for eval capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { inputs: { model: "gpt-4o" }, outputs: "result" } }),
    }));
  });

  async function openFlagForm() {
    render(
      <StepDetailsModal
        step={makeLlmStep({ project_step_id: "gen_step", name: "generate_response" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    // form should appear
    await waitFor(() => expect(screen.getByTestId("capture-eval-form")).toBeInTheDocument());
  }

  it("opens the CaptureEvalForm when Flag for eval is clicked", async () => {
    await openFlagForm();
  });

  it("hides Flag for eval button while form is open", async () => {
    await openFlagForm();
    expect(screen.queryByRole("button", { name: /flag for eval/i })).not.toBeInTheDocument();
  });

  it("submits correct URL and body (inputs/outputs from ioData)", async () => {
    const mockFetch = vi.fn()
      // IO fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { inputs: { model: "gpt-4o", messages: [] }, outputs: "some output" } }),
      })
      // capture POST
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", mockFetch);

    render(
      <StepDetailsModal
        step={makeLlmStep({ project_step_id: "gen_step", name: "generate_response" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );

    // Wait for IO to load (the IO endpoint is keyed by step.id)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
      "/api/projects/run-123/steps/step-llm/io",
    ));

    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    await waitFor(() => expect(screen.getByTestId("capture-eval-form")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Must return a summary" },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture/i }));

    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const captureCall = calls.find(([url]) =>
        String(url).includes("/eval/capture")
      );
      expect(captureCall).toBeDefined();
      const [url, opts] = captureCall!;
      expect(url).toBe("/api/workspaces/my-ws/workflows/42/eval/capture");
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.run_id).toBe("run-123");
      expect(body.step_id).toBe("gen_step");
      expect(body.requirement).toBe("Must return a summary");
      expect(body.inputs).toEqual({ model: "gpt-4o", messages: [] });
      expect(body.outputs).toBe("some output");
    });
  });

  it("shows success toast and closes form on capture", async () => {
    const { toast } = await import("sonner");
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { inputs: { model: "gpt-4o" }, outputs: null } }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", mockFetch);

    render(
      <StepDetailsModal
        // step.id present so the IO useEffect fires
        step={makeLlmStep({ project_step_id: "gen_step" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );

    // Wait for the IO fetch to complete
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    await waitFor(() => screen.getByTestId("capture-eval-form"));

    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Always respond" },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Eval captured");
      expect(screen.queryByTestId("capture-eval-form")).not.toBeInTheDocument();
    });
  });

  it("shows error toast on failed capture", async () => {
    const { toast } = await import("sonner");
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { inputs: { model: "gpt-4o" }, outputs: null } }),
      })
      .mockResolvedValueOnce({ ok: false });
    vi.stubGlobal("fetch", mockFetch);

    render(
      <StepDetailsModal
        step={makeLlmStep({ project_step_id: "gen_step" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    await waitFor(() => screen.getByTestId("capture-eval-form"));

    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Must not fail" },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to capture eval");
    });
  });

  it("shows error toast when ioData is null at submit time", async () => {
    const { toast } = await import("sonner");
    // IO fetch fails → ioData stays null
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error("network error"));
    vi.stubGlobal("fetch", mockFetch);

    render(
      <StepDetailsModal
        // step.id present so the IO useEffect fires and then rejects
        step={makeLlmStep({ project_step_id: "gen_step" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );

    // Wait for the IO fetch attempt (which rejects) to settle
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    await waitFor(() => screen.getByTestId("capture-eval-form"));

    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Step input data not available");
    });
    // No capture POST should be made
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
