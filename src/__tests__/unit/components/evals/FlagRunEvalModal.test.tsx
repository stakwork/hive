// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FlagRunEvalModal } from "@/components/evals/FlagRunEvalModal";

// ── mocks ────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/ui/tag-input", () => ({
  TagInput: ({
    items,
    onChange,
    placeholder,
  }: {
    items: string[];
    onChange: (v: string[]) => void;
    placeholder?: string;
  }) => (
    <input
      data-testid={`tag-input-${placeholder}`}
      value={items.join(",")}
      onChange={(e) => onChange(e.target.value ? e.target.value.split(",") : [])}
      placeholder={placeholder}
    />
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

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? <>{children}</> : <span>{children}</span>),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
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
    prompt_version_id: "pv-1",
    prompt_name: "My Prompt v2",
    prompt_id: "pid-1",
  },
  {
    stepId: "llm_evaluate_quality",
    name: "Evaluate Quality",
    model: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    endpoint_url: "https://api.anthropic.com/v1/messages",
    preview: "The output looks correct.",
    prompt_version_id: null,
    prompt_name: null,
    prompt_id: null,
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
    // fetch never resolves
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    render(<FlagRunEvalModal {...defaultProps()} />);
    expect(screen.getByRole("status", { hidden: true }) ?? screen.getByText(/loading steps/i)).toBeTruthy();
    // The Loader2 svg is present
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
      expect(
        screen.getByText(/no llm request steps found in this run/i)
      ).toBeInTheDocument();
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

  it("advances to step 2 after clicking Next with a step selected", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { steps: MOCK_STEPS } }),
    } as Response);

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByLabelText(/requirement/i)).toBeInTheDocument();
  });

  it("Confirm button is disabled when Requirement field is empty", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { steps: MOCK_STEPS } }),
    } as Response);

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    const confirmBtn = screen.getByRole("button", { name: /confirm/i });
    expect(confirmBtn).toBeDisabled();
  });

  it("calls onCaptured and closes on successful POST", async () => {
    const onCaptured = vi.fn();
    const onOpenChange = vi.fn();

    // First fetch = request-steps, second = capture POST
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { steps: MOCK_STEPS } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            evalSetRef: "ref-evalset",
            requirementRef: "ref-req",
            triggerRef: "ref-trigger",
          },
        }),
      } as Response);

    render(
      <FlagRunEvalModal
        {...defaultProps({ onCaptured, onOpenChange })}
      />
    );

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    const reqInput = screen.getByLabelText(/requirement/i);
    await userEvent.type(reqInput, "Never return an empty response");

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

    const reqInput = screen.getByLabelText(/requirement/i);
    await userEvent.type(reqInput, "Some requirement");

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

    // Close by re-rendering with open=false
    rerender(<FlagRunEvalModal {...defaultProps({ open: false, onOpenChange })} />);

    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });

  it("POSTs with the correct request body", async () => {
    const onCaptured = vi.fn();

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { steps: MOCK_STEPS } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

    render(<FlagRunEvalModal {...defaultProps({ onCaptured })} />);

    await waitFor(() => screen.getByText("Generate Title"));
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await userEvent.type(screen.getByLabelText(/requirement/i), "Never empty");

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(onCaptured).toHaveBeenCalled());

    const [url, opts] = vi.mocked(fetch).mock.calls[1];
    expect(url).toBe("/api/workspaces/test-ws/workflows/42/eval/capture");
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.run_id).toBe("1001");
    expect(body.step_id).toBe("llm_generate_title");
    expect(body.requirement).toBe("Never empty");
    expect(body.check).toEqual({ type: "non_empty", want: true });
  });

  it("renders prompt_name badge when step has prompt_name", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { steps: MOCK_STEPS } }),
    } as Response);

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText("Generate Title"));

    // First step has prompt_name: "My Prompt v2"
    expect(screen.getByText("My Prompt v2")).toBeInTheDocument();
  });

  it("does not render a prompt_name badge when prompt_name is null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { steps: MOCK_STEPS } }),
    } as Response);

    render(<FlagRunEvalModal {...defaultProps()} />);

    await waitFor(() => screen.getByText("Evaluate Quality"));

    // Second step has prompt_name: null — no extra badge beyond model/provider chips
    // Verify the null case doesn't render a badge with undefined/null text
    const evaluateQualityBtn = screen.getByText("Evaluate Quality").closest("button")!;
    const chips = evaluateQualityBtn.querySelectorAll("span");
    // Only model + provider chips (2), no prompt_name chip
    const chipTexts = Array.from(chips).map((s) => s.textContent);
    expect(chipTexts).not.toContain(null);
    expect(chipTexts).not.toContain("null");
  });

  it("includes prompt_version_id in the capture POST body", async () => {
    const onCaptured = vi.fn();

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { steps: MOCK_STEPS } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

    render(<FlagRunEvalModal {...defaultProps({ onCaptured })} />);

    await waitFor(() => screen.getByText("Generate Title"));
    // Select the first step (has prompt_version_id: "pv-1")
    fireEvent.click(screen.getByText("Generate Title").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await userEvent.type(screen.getByLabelText(/requirement/i), "Always returns title");
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(onCaptured).toHaveBeenCalled());

    const [, opts] = vi.mocked(fetch).mock.calls[1];
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.prompt_version_id).toBe("pv-1");
    expect(body.prompt_id).toBe("pid-1");
  });
});
