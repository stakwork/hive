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

  it("clicking Next advances to step 2 without an IO fetch", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { steps: MOCK_STEPS } }),
    } as Response);

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => expect(screen.getByTestId("capture-eval-form")).toBeInTheDocument());

    // No /steps/.../io call should have been made
    const ioCalls = vi.mocked(fetch).mock.calls.filter(([url]) =>
      String(url).includes("/io")
    );
    expect(ioCalls.length).toBe(0);
  });

  it("advances to step 2 showing CaptureEvalForm (no TagInput, no check type)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { steps: MOCK_STEPS } }),
    } as Response);

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => expect(screen.getByTestId("capture-eval-form")).toBeInTheDocument());

    // Should NOT have TagInput or check type fields
    expect(screen.queryByPlaceholderText(/response should…/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/response should not…/i)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("non_empty")).not.toBeInTheDocument();
  });

  it("Confirm button is disabled when requirement field is empty", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { steps: MOCK_STEPS } }),
    } as Response);

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => screen.getByTestId("capture-eval-form"));

    const confirmBtn = screen.getByRole("button", { name: /confirm/i });
    expect(confirmBtn).toBeDisabled();
  });

  it("POSTs inputs/outputs in the capture body", async () => {
    const onCaptured = vi.fn();
    const onOpenChange = vi.fn();

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { steps: MOCK_STEPS } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

    render(<FlagRunEvalModal {...defaultProps({ onCaptured, onOpenChange })} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => screen.getByTestId("capture-eval-form"));

    await userEvent.type(screen.getByRole("textbox", { name: /requirement/i }), "Never return empty");

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
    expect(body.inputs).toEqual({ model: MOCK_STEPS[0].model, messages: MOCK_STEPS[0].messages });
    expect(body.outputs).toEqual({
      response_raw: MOCK_STEPS[0].body.response_raw,
      output_text: MOCK_STEPS[0].body.output_text,
      finish_reason: MOCK_STEPS[0].body.finish_reason,
    });
    // No legacy fields
    expect(body.check).toBeUndefined();
    expect(body.desirable_cases).toBeUndefined();
    expect(body.undesirable_cases).toBeUndefined();
  });

  it("calls onCaptured and closes on successful POST", async () => {
    const onCaptured = vi.fn();
    const onOpenChange = vi.fn();

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { steps: MOCK_STEPS } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

    render(<FlagRunEvalModal {...defaultProps({ onCaptured, onOpenChange })} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => screen.getByTestId("capture-eval-form"));
    await userEvent.type(screen.getByRole("textbox", { name: /requirement/i }), "Always respond");
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => {
      expect(onCaptured).toHaveBeenCalledOnce();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows error toast and does not call onCaptured on failed POST", async () => {
    const { toast } = await import("sonner");
    const onCaptured = vi.fn();

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { steps: MOCK_STEPS } }),
      } as Response)
      .mockResolvedValueOnce({ ok: false } as Response);

    render(<FlagRunEvalModal {...defaultProps({ onCaptured })} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => screen.getByTestId("capture-eval-form"));
    await userEvent.type(screen.getByRole("textbox", { name: /requirement/i }), "Some requirement");
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
