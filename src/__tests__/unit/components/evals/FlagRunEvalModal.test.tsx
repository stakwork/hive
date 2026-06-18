// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FlagRunEvalModal } from "@/components/evals/FlagRunEvalModal";

// ── mocks ────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { CREATE_NEW_VALUE } = vi.hoisted(() => ({ CREATE_NEW_VALUE: "__create_new__" }));

vi.mock("@/components/evals/CaptureEvalForm", () => ({
  CREATE_NEW_VALUE,
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
        aria-label="requirement"
        value={requirement}
        onChange={(e) => onRequirementChange(e.target.value)}
        disabled={submitting}
      />
      <input
        aria-label="reason"
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        disabled={submitting}
      />
    </div>
  ),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Minimal Dialog that renders children when open
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange?: (v: boolean) => void;
    children: React.ReactNode;
  }) =>
    open ? (
      <div data-testid="dialog">
        {children}
        <button data-testid="dialog-close" onClick={() => onOpenChange?.(false)} />
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const MOCK_STEPS = [
  {
    stepId: "llm_generate_title",
    name: "Generate Title",
    model: "gpt-4o-mini",
    provider: "openai",
    endpoint_url: "https://api.openai.com/v1/chat/completions",
    preview: "The title looks great.",
    method: "POST",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Generate a title for this content." },
    ],
    body: {
      response_raw: JSON.stringify({ choices: [{ message: { content: "Sample Title" }, finish_reason: "stop" }] }),
      output_text: "Sample Title",
      finish_reason: "stop",
      prompt_change: null,
      model: "gpt-4o-mini",
    },
  },
  {
    stepId: "llm_evaluate_quality",
    name: "Evaluate Quality",
    model: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    endpoint_url: "https://api.anthropic.com/v1/messages",
    preview: "The output looks correct.",
    method: "POST",
    messages: [
      { role: "system", content: "You are a quality evaluation assistant." },
      { role: "user", content: "Evaluate the quality of the following output." },
    ],
    body: {
      response_raw: JSON.stringify({ content: [{ text: "High quality.", type: "text" }], stop_reason: "end_turn" }),
      output_text: "High quality.",
      finish_reason: "end_turn",
      prompt_change: null,
      model: "claude-3-5-sonnet-20241022",
    },
  },
];

const MOCK_IO_INPUTS = {
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Generate a title" }],
};
const MOCK_IO_OUTPUTS = {
  choices: [{ message: { content: "A great title" }, finish_reason: "stop" }],
};

function defaultProps(overrides: Partial<React.ComponentProps<typeof FlagRunEvalModal>> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    slug: "test-ws",
    workflowId: "42",
    runId: "1001",
    onCaptured: vi.fn(),
    ...overrides,
  };
}

// Advancing to step 2 fetches the workspace eval sets; the component auto-selects
// the first one. A non-empty response is required for the Confirm flow to proceed.
const MOCK_EVAL_SETS_RESPONSE = {
  success: true,
  data: {
    nodes: [{ ref_id: "set-1", properties: { name: "Default Eval Set" } }],
    total: 1,
  },
};

// URL-aware fetch mock covering all endpoints the modal hits: request-steps (on open),
// steps IO (on Next), evals (on step 2), and eval/capture (on confirm).
function makeFetch({
  steps = MOCK_STEPS,
  captureOk = true,
  evalSetsResponse = MOCK_EVAL_SETS_RESPONSE,
  ioInputs = MOCK_IO_INPUTS,
  ioOutputs = MOCK_IO_OUTPUTS,
}: {
  steps?: typeof MOCK_STEPS;
  captureOk?: boolean;
  evalSetsResponse?: object;
  ioInputs?: unknown;
  ioOutputs?: unknown;
} = {}) {
  return vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes("/request-steps")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { steps } }) } as Response);
    }
    if (u.includes("/steps/") && u.includes("/io")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { inputs: ioInputs, outputs: ioOutputs } }),
      } as Response);
    }
    if (u.endsWith("/evals")) {
      return Promise.resolve({ ok: true, json: async () => evalSetsResponse } as Response);
    }
    if (u.includes("/eval/capture")) {
      return Promise.resolve(
        captureOk
          ? ({ ok: true, json: async () => ({ success: true, data: {} }) } as Response)
          : ({ ok: false } as Response),
      );
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("FlagRunEvalModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders loading spinner while fetching steps", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    render(<FlagRunEvalModal {...defaultProps()} />);
    expect(screen.getByRole("status", { hidden: true }) ?? screen.getByText(/loading steps/i)).toBeTruthy();
    const content = screen.getByTestId("dialog-content");
    expect(content.innerHTML).toContain("animate-spin");
  });

  it("renders step list after fetch resolves", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { steps: MOCK_STEPS } }),
    } as Response);

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => {
      expect(screen.getByText("Generate Title")).toBeInTheDocument();
      expect(screen.getByText("Evaluate Quality")).toBeInTheDocument();
    });
  });

  it("shows empty-state when steps array is empty", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { steps: [] } }),
    } as Response);

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => {
      expect(screen.getByText(/no llm request steps found in this run/i)).toBeInTheDocument();
    });
  });

  it("shows only Close button (no Next) when steps is empty", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { steps: [] } }),
    } as Response);

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText(/no llm request steps/i));

    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
  });

  it("Next button is disabled when no step is selected", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { steps: MOCK_STEPS } }),
    } as Response);

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText("Generate Title"));

    const nextBtn = screen.getByRole("button", { name: /next/i });
    expect(nextBtn).toBeDisabled();
  });

  it("Next button enables after selecting a step", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { steps: MOCK_STEPS } }),
    } as Response);

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);

    const nextBtn = screen.getByRole("button", { name: /next/i });
    expect(nextBtn).not.toBeDisabled();
  });

  it("clicking Next shows spinner during IO fetch then advances to step 2", async () => {
    vi.stubGlobal("fetch", makeFetch());

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);

    // Intercept the IO fetch with a controllable promise
    let resolveIO!: (v: Response) => void;
    const ioPromise = new Promise<Response>((res) => { resolveIO = res; });
    vi.mocked(fetch).mockImplementationOnce(() => ioPromise);

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // While IO is pending, Next button should be disabled with spinner
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    });
    expect(screen.getByTestId("dialog-content").innerHTML).toContain("animate-spin");

    resolveIO({
      ok: true,
      json: async () => ({ data: { inputs: MOCK_IO_INPUTS, outputs: MOCK_IO_OUTPUTS } }),
    } as Response);

    await waitFor(() => expect(screen.getByTestId("capture-eval-form")).toBeInTheDocument());
  });

  it("fetches IO via /api/projects/${runId}/steps/${stepId}/io when clicking Next", async () => {
    vi.stubGlobal("fetch", makeFetch());

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => expect(screen.getByTestId("capture-eval-form")).toBeInTheDocument());

    const ioCalls = vi.mocked(fetch).mock.calls.filter(([url]) =>
      String(url).includes("/io")
    );
    expect(ioCalls.length).toBe(1);
    expect(String(ioCalls[0][0])).toBe("/api/projects/1001/steps/llm_generate_title/io");
  });

  it("advances to step 2 showing CaptureEvalForm (no TagInput, no check type)", async () => {
    vi.stubGlobal("fetch", makeFetch());

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => expect(screen.getByTestId("capture-eval-form")).toBeInTheDocument());

    expect(screen.queryByPlaceholderText(/response should…/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/response should not…/i)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("non_empty")).not.toBeInTheDocument();
  });

  it("Confirm button is disabled when requirement field is empty", async () => {
    vi.stubGlobal("fetch", makeFetch());

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => screen.getByTestId("capture-eval-form"));

    const confirmBtn = screen.getByRole("button", { name: /confirm/i });
    expect(confirmBtn).toBeDisabled();
  });

  it("POSTs fetched inputs/outputs (not inline-constructed) in the capture body", async () => {
    const onCaptured = vi.fn();
    const onOpenChange = vi.fn();

    vi.stubGlobal("fetch", makeFetch());

    render(<FlagRunEvalModal {...defaultProps({ onCaptured, onOpenChange })} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => screen.getByTestId("capture-eval-form"));

    await userEvent.type(screen.getByRole("textbox", { name: /requirement/i }), "Never return empty");

    // Confirm stays disabled until the auto-selected eval set resolves
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(onCaptured).toHaveBeenCalledOnce());

    const captureCalls = vi.mocked(fetch).mock.calls.filter(([url]) =>
      String(url).includes("/eval/capture")
    );
    expect(captureCalls.length).toBe(1);
    const [url, opts] = captureCalls[0];
    expect(url).toBe("/api/workspaces/test-ws/workflows/42/eval/capture");
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.run_id).toBe("1001");
    expect(body.step_id).toBe("llm_generate_title");
    expect(body.requirement).toBe("Never return empty");
    expect(body.evalSetId).toBe("set-1");

    // inputs/outputs must come from the IO fetch, not from inline step field extraction
    expect(body.inputs).toEqual(MOCK_IO_INPUTS);
    expect(body.outputs).toEqual(MOCK_IO_OUTPUTS);

    // No legacy fields
    expect(body.check).toBeUndefined();
    expect(body.desirable_cases).toBeUndefined();
    expect(body.undesirable_cases).toBeUndefined();
  });

  it("proceeds with null IO when IO fetch fails, still submits", async () => {
    const onCaptured = vi.fn();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes("/request-steps")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: { steps: MOCK_STEPS } }) } as Response);
        }
        if (u.includes("/steps/") && u.includes("/io")) {
          return Promise.reject(new Error("network error"));
        }
        if (u.endsWith("/evals")) {
          return Promise.resolve({ ok: true, json: async () => MOCK_EVAL_SETS_RESPONSE } as Response);
        }
        if (u.includes("/eval/capture")) {
          return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      }),
    );

    render(<FlagRunEvalModal {...defaultProps({ onCaptured })} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => screen.getByTestId("capture-eval-form"));

    await userEvent.type(screen.getByRole("textbox", { name: /requirement/i }), "Some requirement");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(onCaptured).toHaveBeenCalledOnce());

    const captureCalls = vi.mocked(fetch).mock.calls.filter(([url]) =>
      String(url).includes("/eval/capture")
    );
    const body = JSON.parse((captureCalls[0][1] as RequestInit).body as string);
    expect(body.inputs).toBeNull();
    expect(body.outputs).toBeNull();
  });

  it("calls onCaptured and closes on successful POST", async () => {
    const onCaptured = vi.fn();
    const onOpenChange = vi.fn();

    vi.stubGlobal("fetch", makeFetch());

    render(<FlagRunEvalModal {...defaultProps({ onCaptured, onOpenChange })} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => screen.getByTestId("capture-eval-form"));
    await userEvent.type(screen.getByRole("textbox", { name: /requirement/i }), "Always respond");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => {
      expect(onCaptured).toHaveBeenCalledOnce();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows error toast and does not call onCaptured on failed POST", async () => {
    const { toast } = await import("sonner");
    const onCaptured = vi.fn();

    vi.stubGlobal("fetch", makeFetch({ captureOk: false }));

    render(<FlagRunEvalModal {...defaultProps({ onCaptured })} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => screen.getByTestId("capture-eval-form"));
    await userEvent.type(screen.getByRole("textbox", { name: /requirement/i }), "Some requirement");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm/i })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to capture eval");
      expect(onCaptured).not.toHaveBeenCalled();
    });
  });

  it("resets state when modal closes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { steps: MOCK_STEPS } }),
    } as Response);

    const onOpenChange = vi.fn();
    const { rerender } = render(
      <FlagRunEvalModal {...defaultProps({ onOpenChange })} />
    );

    await waitFor(() => screen.getByText("Generate Title"));

    rerender(<FlagRunEvalModal {...defaultProps({ open: false, onOpenChange })} />);

    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });
});
