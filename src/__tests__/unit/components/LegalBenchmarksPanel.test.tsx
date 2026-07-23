/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: "openlaw", isSuperAdmin: false }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "scroll-area" }, children),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) =>
    React.createElement("div", { "data-testid": "skeleton", className }),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement("div", { "data-testid": "card", className }, children),
  CardContent: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement("div", { className }, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className, variant }: { children?: React.ReactNode; className?: string; variant?: string }) =>
    React.createElement("span", { "data-testid": "badge", className, "data-variant": variant }, children),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    size,
    variant,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    size?: string;
    variant?: string;
    disabled?: boolean;
  }) =>
    React.createElement(
      "button",
      { onClick, "data-size": size, "data-variant": variant, disabled },
      children
    ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({
    placeholder,
    value,
    onChange,
    className,
  }: {
    placeholder?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    className?: string;
  }) =>
    React.createElement("input", { placeholder, value, onChange, className }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children?: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "select-root", "data-value": value },
      // Expose onValueChange as a data attr via a hidden button for testing
      React.createElement(
        "button",
        {
          "data-testid": "select-trigger-internal",
          onClick: () => onValueChange?.("anthropic/claude-haiku-4-5"),
          style: { display: "none" },
        },
        null
      ),
      children,
    ),
  SelectTrigger: ({
    children,
    className,
    "data-testid": testId,
  }: {
    children?: React.ReactNode;
    className?: string;
    "data-testid"?: string;
  }) =>
    React.createElement("div", { "data-testid": testId ?? "select-trigger", className }, children),
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    React.createElement("span", { "data-testid": "select-value" }, placeholder),
  SelectContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "select-content" }, children),
  SelectItem: ({
    children,
    value,
    className,
  }: {
    children?: React.ReactNode;
    value?: string;
    className?: string;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "select-item", "data-value": value, className },
      children
    ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "tooltip" }, children),
  TooltipTrigger: ({ children, asChild }: { children?: React.ReactNode; asChild?: boolean }) =>
    React.createElement("div", { "data-testid": "tooltip-trigger" }, children),
  TooltipContent: ({ children, side, className }: { children?: React.ReactNode; side?: string; className?: string }) =>
    React.createElement("div", { "data-testid": "tooltip-content", "data-side": side, className }, children),
}));

// Mock TaskDetailsModal to control its rendering in isolation
vi.mock("@/components/legal/TaskDetailsModal", () => ({
  TaskDetailsModal: ({
    open,
    onOpenChange,
    task,
    slug,
    onRunTask,
  }: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    task: { slug: string; title: string };
    slug: string;
    onRunTask: () => void;
  }) =>
    open
      ? React.createElement(
          "div",
          { "data-testid": "task-details-modal", "data-task-slug": task?.slug, "data-slug": slug },
          React.createElement("p", null, task?.title),
          React.createElement("button", { onClick: () => { onOpenChange(false); onRunTask(); } }, "Run Task"),
          React.createElement("button", { onClick: () => onOpenChange(false) }, "Close"),
        )
      : null,
}));

// Mock LegalBenchmarkResults to avoid deep rendering
vi.mock("@/components/legal/LegalBenchmarkResults", () => ({
  LegalBenchmarkResults: ({
    runId,
    onReset,
    isSuperAdmin: _isSuperAdmin,
  }: {
    runId: string;
    onReset: () => void;
    isSuperAdmin?: boolean;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "legal-benchmark-results", "data-run-id": runId },
      React.createElement("button", { onClick: onReset }, "Reset")
    ),
}));

// ─── Mock fetch ──────────────────────────────────────────────────────────────

const MOCK_LLM_MODELS = [
  { id: "m1", name: "claude-sonnet-5", provider: "ANTHROPIC", providerLabel: null, isPlanDefault: false, isTaskDefault: false },
  { id: "m2", name: "claude-sonnet-4-6", provider: "ANTHROPIC", providerLabel: null, isPlanDefault: false, isTaskDefault: false },
  { id: "m3", name: "claude-opus-4-6", provider: "ANTHROPIC", providerLabel: null, isPlanDefault: false, isTaskDefault: false },
  // Non-Anthropic — should be filtered out
  { id: "m4", name: "gpt-4o", provider: "OPENAI", providerLabel: null, isPlanDefault: false, isTaskDefault: false },
];

const MOCK_RESPONSE = {
  total: 1749,
  practice_areas: [
    {
      slug: "antitrust-competition",
      label: "Antitrust Competition",
      task_count: 3,
      tasks: [
        { slug: "antitrust-competition/task-1", title: "Analyze Antitrust HSR Strategy", work_type: "review", tags: ["hsr", "merger", "antitrust"] },
        { slug: "antitrust-competition/task-2", title: "Assess Market Definition", work_type: "identify", tags: ["market-definition"] },
        { slug: "antitrust-competition/task-3", title: "Cartel Investigation Memo", work_type: "draft", tags: ["cartel"] },
      ],
    },
    {
      slug: "banking-finance",
      label: "Banking & Finance",
      task_count: 2,
      tasks: [
        { slug: "banking-finance/task-1", title: "Loan Agreement Review", work_type: "review", tags: ["loan"] },
        { slug: "banking-finance/task-2", title: "Credit Facility Draft", work_type: "draft", tags: ["credit"] },
      ],
    },
  ],
};

// ─── Import after mocks ───────────────────────────────────────────────────────

const { LegalBenchmarksPanel } = await import(
  "@/components/legal/LegalBenchmarksPanel"
);

const { toast } = await import("sonner");
const mockToast = vi.mocked(toast);

// Helper: URL-aware fetch mock. Handles the parallel tasks + llm-models fetch,
// and optionally overrides the POST /run response.
function makeDefaultFetch(opts: {
  runResponse?: { ok: boolean; json: () => Promise<unknown> };
  tasksError?: boolean;
} = {}) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/llm-models") {
      return Promise.resolve({ ok: true, json: async () => ({ models: MOCK_LLM_MODELS }) });
    }
    if (typeof url === "string" && url.includes("/legal/benchmarks/tasks")) {
      if (opts.tasksError) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "Server error" }) });
      }
      return Promise.resolve({ ok: true, json: async () => MOCK_RESPONSE });
    }
    if (typeof url === "string" && url.includes("/legal/benchmarks/run") && (init as RequestInit | undefined)?.method === "POST") {
      return Promise.resolve(
        opts.runResponse ?? { ok: true, json: async () => ({ run_id: "run-abc" }) }
      );
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LegalBenchmarksPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", makeDefaultFetch());
  });

  it("shows skeleton while loading", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {}))); // never resolves
    render(React.createElement(LegalBenchmarksPanel));
    const skeletons = screen.getAllByTestId("skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders practice areas after load", async () => {
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getByText("Antitrust Competition")).toBeInTheDocument();
      expect(screen.getByText("Banking & Finance")).toBeInTheDocument();
    });
  });

  it("auto-selects first practice area and shows its tasks", async () => {
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getByText("Analyze Antitrust HSR Strategy")).toBeInTheDocument();
      expect(screen.getByText("Assess Market Definition")).toBeInTheDocument();
      expect(screen.getByText("Cartel Investigation Memo")).toBeInTheDocument();
    });
  });

  it("switches task list when a different practice area is selected", async () => {
    const user = userEvent.setup();
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getByText("Banking & Finance")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Banking & Finance"));

    await waitFor(() => {
      expect(screen.getByText("Loan Agreement Review")).toBeInTheDocument();
      expect(screen.getByText("Credit Facility Draft")).toBeInTheDocument();
    });

    expect(screen.queryByText("Analyze Antitrust HSR Strategy")).not.toBeInTheDocument();
  });

  it("filters tasks by title when searching", async () => {
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getByText("Analyze Antitrust HSR Strategy")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search tasks…");
    fireEvent.change(searchInput, { target: { value: "market" } });

    await waitFor(() => {
      expect(screen.getByText("Assess Market Definition")).toBeInTheDocument();
      expect(screen.queryByText("Analyze Antitrust HSR Strategy")).not.toBeInTheDocument();
      expect(screen.queryByText("Cartel Investigation Memo")).not.toBeInTheDocument();
    });
  });

  it("shows empty state when search matches no tasks", async () => {
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getByText("Analyze Antitrust HSR Strategy")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search tasks…");
    fireEvent.change(searchInput, { target: { value: "xyznonexistent" } });

    await waitFor(() => {
      expect(screen.getByText("No tasks match your search.")).toBeInTheDocument();
    });
  });

  it("handleSelectTask calls POST /run and sets activeRunId", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", makeDefaultFetch());

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Select Task").length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText("Select Task")[0]);

    await waitFor(() => {
      expect(screen.getByTestId("legal-benchmark-results")).toBeInTheDocument();
    });

    const fetchMock = vi.mocked(global.fetch);
    const runCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === "string" &&
        url.includes("/legal/benchmarks/run") &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    expect(runCall).toBeDefined();

    expect(screen.getByTestId("legal-benchmark-results")).toHaveAttribute("data-run-id", "run-abc");
  });

  it("handleSelectTask includes model and judgeModel in POST body with defaults", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", makeDefaultFetch());

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Select Task").length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText("Select Task")[0]);

    await waitFor(() => {
      expect(screen.getByTestId("legal-benchmark-results")).toBeInTheDocument();
    });

    const fetchMock = vi.mocked(global.fetch);
    const runCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === "string" &&
        url.includes("/legal/benchmarks/run") &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    expect(runCall).toBeDefined();
    const body = JSON.parse((runCall![1] as RequestInit).body as string);
    expect(body.model).toBe("anthropic/claude-sonnet-5");
    expect(body.judgeModel).toBe("anthropic/claude-sonnet-4-6");
  });

  it("shows toast.error when POST /run returns 409", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      makeDefaultFetch({
        runResponse: {
          ok: false,
          json: async () => ({ error: "A run is already in progress for this task" }),
        },
      })
    );

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Select Task").length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText("Select Task")[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        "A run is already in progress for this task"
      );
    });

    expect(screen.queryByTestId("legal-benchmark-results")).not.toBeInTheDocument();
  });

  it("shows toast.error on generic POST /run failure", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      makeDefaultFetch({
        runResponse: {
          ok: false,
          json: async () => ({ error: null }),
        },
      })
    );

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Select Task").length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText("Select Task")[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("Failed to start run");
    });
  });

  it("disables only the running card's button while a run is active", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", makeDefaultFetch());

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Select Task").length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText("Select Task")[0]);

    await waitFor(() => {
      expect(screen.getByTestId("legal-benchmark-results")).toBeInTheDocument();
    });

    expect(screen.getByText("Running…")).toBeInTheDocument();
    const runningBtn = screen.getByText("Running…").closest("button");
    expect(runningBtn).toBeDisabled();

    const remainingSelectButtons = screen.getAllByText("Select Task");
    remainingSelectButtons.forEach((btn) => {
      expect(btn.closest("button")).not.toBeDisabled();
    });
  });

  it("hides results panel and re-enables button when onReset is called", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", makeDefaultFetch());

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Select Task").length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText("Select Task")[0]);

    await waitFor(() => {
      expect(screen.getByTestId("legal-benchmark-results")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Reset"));

    await waitFor(() => {
      expect(screen.queryByTestId("legal-benchmark-results")).not.toBeInTheDocument();
    });

    expect(screen.queryByText("Running…")).not.toBeInTheDocument();
    expect(screen.getAllByText("Select Task").length).toBeGreaterThan(0);
  });

  it("search is case-insensitive", async () => {
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getByText("Analyze Antitrust HSR Strategy")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search tasks…");
    fireEvent.change(searchInput, { target: { value: "ANTITRUST" } });

    await waitFor(() => {
      expect(screen.getByText("Analyze Antitrust HSR Strategy")).toBeInTheDocument();
    });
  });

  it("shows error state on fetch failure", async () => {
    vi.stubGlobal("fetch", makeDefaultFetch({ tasksError: true }));

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch tasks/i)).toBeInTheDocument();
    });
  });

  it("shows error when tasksRes fails even if modelsRes succeeds", async () => {
    // modelsRes returns ok:true with valid envelope; tasksRes returns ok:false
    // Ensures a tasks failure is surfaced and doesn't get masked by the models path
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/llm-models") {
          return Promise.resolve({ ok: true, json: async () => ({ models: MOCK_LLM_MODELS }) });
        }
        if (typeof url === "string" && url.includes("/legal/benchmarks/tasks")) {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "Server error" }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      })
    );

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch tasks/i)).toBeInTheDocument();
    });
  });

  it("renders task count badges for practice areas", async () => {
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      const badges = screen.getAllByTestId("badge");
      const countBadges = badges.filter((b) => ["3", "2"].includes(b.textContent ?? ""));
      expect(countBadges.length).toBeGreaterThan(0);
    });
  });

  // ─── Task Details Modal ───────────────────────────────────────────────────

  it("each task card shows a Details button", async () => {
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      const detailsButtons = screen.getAllByText("Details");
      expect(detailsButtons.length).toBeGreaterThan(0);
    });
  });

  it("clicking Details opens the task details modal with correct task", async () => {
    const user = userEvent.setup();
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Details").length).toBeGreaterThan(0);
    });

    const detailsButtons = screen.getAllByText("Details");
    await user.click(detailsButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId("task-details-modal")).toBeInTheDocument();
    });

    // Modal shows first task's title — scope to modal to avoid matching the task card too
    const { within } = await import("@testing-library/react");
    const modal = screen.getByTestId("task-details-modal");
    expect(within(modal).getByText("Analyze Antitrust HSR Strategy")).toBeInTheDocument();
  });

  it("closing the modal via Close button hides it", async () => {
    const user = userEvent.setup();
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Details").length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText("Details")[0]);

    await waitFor(() => {
      expect(screen.getByTestId("task-details-modal")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Close"));

    await waitFor(() => {
      expect(screen.queryByTestId("task-details-modal")).not.toBeInTheDocument();
    });
  });

  it("Run Task inside modal closes modal and calls handleSelectTask", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      makeDefaultFetch({ runResponse: { ok: true, json: async () => ({ run_id: "run-from-modal" }) } })
    );

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Details").length).toBeGreaterThan(0);
    });

    // Open modal for first task
    await user.click(screen.getAllByText("Details")[0]);

    await waitFor(() => {
      expect(screen.getByTestId("task-details-modal")).toBeInTheDocument();
    });

    // Click Run Task inside modal
    await user.click(screen.getByText("Run Task"));

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByTestId("task-details-modal")).not.toBeInTheDocument();
    });

    // POST /run should have been called
    await waitFor(() => {
      const fetchMock = vi.mocked(global.fetch);
      const runCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/legal/benchmarks/run") &&
          (init as RequestInit | undefined)?.method === "POST"
      );
      expect(runCall).toBeDefined();
    });

    // Results panel should appear
    await waitFor(() => {
      expect(screen.getByTestId("legal-benchmark-results")).toBeInTheDocument();
    });
  });

  it("modal receives the correct workspace slug", async () => {
    const user = userEvent.setup();
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Details").length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText("Details")[0]);

    await waitFor(() => {
      const modal = screen.getByTestId("task-details-modal");
      expect(modal).toHaveAttribute("data-slug", "openlaw");
    });
  });

  // ─── Model pickers ────────────────────────────────────────────────────────

  it("renders Execution Model and Judge Model dropdowns after load", async () => {
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getByText("Execution Model")).toBeInTheDocument();
      expect(screen.getByText("Judge Model")).toBeInTheDocument();
    });

    // Both select triggers should be present
    expect(screen.getByTestId("execution-model-select")).toBeInTheDocument();
    expect(screen.getByTestId("judge-model-select")).toBeInTheDocument();
  });

  it("renders only Anthropic models in picker options (not OpenAI)", async () => {
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      // claude-sonnet-5 is Anthropic — should appear
      expect(screen.getAllByText("claude-sonnet-5").length).toBeGreaterThan(0);
      // gpt-4o is OPENAI — should NOT appear in any SelectItem
      const gptItems = screen.queryAllByTestId("select-item").filter(
        (el) => el.textContent === "gpt-4o"
      );
      expect(gptItems).toHaveLength(0);
    });
  });

  it("defaults selectedModel to anthropic/claude-sonnet-5", async () => {
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      const triggers = screen.getAllByTestId("select-root");
      // First select is Execution Model
      expect(triggers[0]).toHaveAttribute("data-value", "anthropic/claude-sonnet-5");
    });
  });

  it("defaults selectedJudgeModel to anthropic/claude-sonnet-4-6", async () => {
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      const triggers = screen.getAllByTestId("select-root");
      // Second select is Judge Model
      expect(triggers[1]).toHaveAttribute("data-value", "anthropic/claude-sonnet-4-6");
    });
  });

  it("shows judge model info tooltip", async () => {
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getByText("Judge Model")).toBeInTheDocument();
    });

    // Tooltip content with the workflow note should be present in the DOM
    const tooltipContents = screen.getAllByTestId("tooltip-content");
    const judgeTooltip = tooltipContents.find((el) =>
      el.textContent?.includes("judge_model")
    );
    expect(judgeTooltip).toBeDefined();
  });

  it("TaskDetailsModal onRunTask triggers handleSelectTask with current model state", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      makeDefaultFetch({ runResponse: { ok: true, json: async () => ({ run_id: "run-modal-model" }) } })
    );

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Details").length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText("Details")[0]);

    await waitFor(() => {
      expect(screen.getByTestId("task-details-modal")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Run Task"));

    await waitFor(() => {
      const fetchMock = vi.mocked(global.fetch);
      const runCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/legal/benchmarks/run") &&
          (init as RequestInit | undefined)?.method === "POST"
      );
      expect(runCall).toBeDefined();
      const body = JSON.parse((runCall![1] as RequestInit).body as string);
      // Modal uses panel's current model state
      expect(body.model).toBe("anthropic/claude-sonnet-5");
      expect(body.judgeModel).toBe("anthropic/claude-sonnet-4-6");
    });
  });
});
