/**
 * @vitest-environment jsdom
 *
 * Tests for EvalRunsBox rewritten to consume ProposedFix[] from props.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

globalThis.React = React;

// ─── Pusher mock (follows useCanvasChatAutoSave.test.ts pattern) ─────────────
const { fakePusher } = vi.hoisted(() => {
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  const channel = {
    bind: (ev: string, h: (...a: unknown[]) => void) => {
      (handlers[ev] ??= []).push(h);
    },
    unbind: (ev: string) => {
      handlers[ev] = [];
    },
    unbind_all: () => {
      Object.keys(handlers).forEach((k) => { handlers[k] = []; });
    },
  };
  const client = {
    subscribe: () => channel,
    unsubscribe: () => {},
  };
  return {
    fakePusher: {
      client,
      /**
       * Simulate a Pusher event on the subscribed channel.
       * All registered handlers for the event are called.
       */
      fire: (ev: string, data: unknown) => {
        (handlers[ev] ?? []).forEach((h) => h(data));
      },
    },
  };
});

vi.mock("@/lib/pusher", () => ({
  getPusherClient: () => fakePusher.client,
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: {
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
  },
}));

// ─── useWorkspace ─────────────────────────────────────────────────────────────
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ workspace: { slug: "openlaw", id: "ws-1" } }),
}));

// ─── sonner ──────────────────────────────────────────────────────────────────
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// ─── UI primitives ────────────────────────────────────────────────────────────
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) =>
    React.createElement("div", { "data-testid": "skeleton", className }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    [k: string]: unknown;
  }) => React.createElement("button", { onClick, disabled, ...rest }, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    className,
    variant,
  }: {
    children: React.ReactNode;
    className?: string;
    variant?: string;
  }) =>
    React.createElement(
      "span",
      { "data-testid": "badge", className, "data-variant": variant },
      children,
    ),
}));

// ─── StakworkRunLink mock ─────────────────────────────────────────────────────
vi.mock("@/components/legal/StakworkRunLink", () => ({
  StakworkRunLink: ({ projectId, isSuperAdmin }: { projectId: number | null; isSuperAdmin: boolean }) =>
    isSuperAdmin && projectId
      ? React.createElement(
          "a",
          { href: `https://jobs.stakwork.com/admin/projects/${projectId}` },
          "View on Stakwork",
        )
      : null,
}));

// ─── useLegalBenchmarkEval ────────────────────────────────────────────────────
const mockRunEval = vi.fn(async () => ({
  status: "started" as import("@/hooks/useLegalBenchmarkEval").EvalResultStatus,
  message: "Eval started.",
  projectId: 99,
}));

vi.mock("@/hooks/useLegalBenchmarkEval", () => ({
  useLegalBenchmarkEval: () => ({
    runEval: mockRunEval,
    isSubmitting: false,
  }),
}));

// ─── Component under test ─────────────────────────────────────────────────────
const { EvalRunsBox } = await import("@/components/legal/EvalRunsBox");

// ─── Helpers ──────────────────────────────────────────────────────────────────
const mockRefetch = vi.fn();

function makeFix(
  overrides: Partial<import("@/types/legal").ProposedFix> = {},
): import("@/types/legal").ProposedFix {
  return {
    ref_id: "fix-1",
    criterion_id: "crit-1",
    criterion_title: "Accuracy",
    prompt_name: "my-prompt",
    delta: "Added more context",
    before_score: "6",
    after_score: "8",
    score_delta: "+2",
    status: "pending",
    passing_value: "Improved prompt text",
    failing_value: "Original prompt text",
    reasoning: "The new version is clearer.",
    resolved_by: null,
    resolved_at: null,
    ...overrides,
  };
}

function renderBox(props: Partial<React.ComponentProps<typeof EvalRunsBox>> = {}) {
  return render(
    React.createElement(EvalRunsBox, {
      taskSlug: "antitrust/task-1",
      runId: "run-abc",
      showRunEvalButton: true,
      fixes: [],
      isLoading: false,
      refetch: mockRefetch,
      ...props,
    }),
  );
}

async function clickRunEval() {
  fireEvent.click(screen.getByRole("button", { name: "Run Eval" }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("EvalRunsBox — empty & loading states", () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders "No eval results yet." when fixes=[] and isLoading=false', () => {
    renderBox({ fixes: [], isLoading: false });
    expect(screen.getByText("No eval results yet.")).toBeInTheDocument();
  });

  it("renders skeleton rows when isLoading=true and fixes=[]", () => {
    renderBox({ fixes: [], isLoading: true });
    const skeletons = screen.getAllByTestId("skeleton");
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("EvalRunsBox — collapsed row rendering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders Accepted badge (green) for status='accepted'", () => {
    renderBox({ fixes: [makeFix({ status: "accepted" })] });
    const badge = screen.getByTestId("badge");
    expect(badge).toHaveTextContent("Accepted");
    expect(badge.className).toContain("green");
  });

  it("renders Rejected badge (red) for status='rejected'", () => {
    renderBox({ fixes: [makeFix({ status: "rejected" })] });
    const badge = screen.getByTestId("badge");
    expect(badge).toHaveTextContent("Rejected");
    expect(badge.className).toContain("red");
  });

  it("renders Pending badge (muted) for status='pending'", () => {
    renderBox({ fixes: [makeFix({ status: "pending" })] });
    const badge = screen.getByTestId("badge");
    expect(badge).toHaveTextContent("Pending");
  });

  it("renders Criterion column from criterion_title", () => {
    renderBox({ fixes: [makeFix({ criterion_title: "My Criterion" })] });
    expect(screen.getByText("My Criterion")).toBeInTheDocument();
  });

  it("renders Prompt column from prompt_name", () => {
    renderBox({ fixes: [makeFix({ prompt_name: "cool-prompt" })] });
    expect(screen.getByText("cool-prompt")).toBeInTheDocument();
  });

  it("renders Score as 'before → after' when both present", () => {
    renderBox({ fixes: [makeFix({ before_score: "6", after_score: "8", score_delta: "+2" })] });
    expect(screen.getByText("6 → 8")).toBeInTheDocument();
  });

  it("renders Score as score_delta when before/after are null", () => {
    renderBox({
      fixes: [makeFix({ before_score: null, after_score: null, score_delta: "+2" })],
    });
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("renders Score as score_delta (not '→') when before_score and after_score are empty strings", () => {
    renderBox({
      fixes: [makeFix({ before_score: "", after_score: "", score_delta: "+2" })],
    });
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.queryByText(/→/)).toBeNull();
  });

  it("renders eval_status badge when eval_status='accepted' and status='pending' (eval_status wins)", () => {
    renderBox({
      fixes: [makeFix({ eval_status: "accepted", status: "pending" })],
    });
    const badge = screen.getByTestId("badge");
    expect(badge.textContent).toBe("Accepted");
    expect(badge.className).toMatch(/green/);
  });

  it("falls back to status badge when eval_status is null", () => {
    renderBox({
      fixes: [makeFix({ eval_status: null, status: "accepted" })],
    });
    const badge = screen.getByTestId("badge");
    expect(badge.textContent).toBe("Accepted");
    expect(badge.className).toMatch(/green/);
  });

  it("renders StakworkRunLink for real row when isSuperAdmin=true and project_id is set", () => {
    renderBox({
      fixes: [makeFix({ project_id: 99 })],
      isSuperAdmin: true,
    });
    const link = screen.getByRole("link", { name: "View on Stakwork" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://jobs.stakwork.com/admin/projects/99");
  });

  it("renders no StakworkRunLink for real row when isSuperAdmin=true and project_id is null", () => {
    renderBox({
      fixes: [makeFix({ project_id: null })],
      isSuperAdmin: true,
    });
    expect(screen.queryByRole("link", { name: "View on Stakwork" })).toBeNull();
  });

  it("truncates Change column to 80 chars + ellipsis", () => {
    const longDelta = "x".repeat(90);
    renderBox({ fixes: [makeFix({ delta: longDelta })] });
    expect(screen.getByText("x".repeat(80) + "…")).toBeInTheDocument();
  });
});

describe("EvalRunsBox — expand/collapse", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clicking chevron shows expanded content", async () => {
    renderBox({ fixes: [makeFix()] });

    // Expanded content is not visible initially
    expect(screen.queryByText("Proposed Prompt")).toBeNull();

    // Click the expand button
    const chevron = screen.getByRole("button", { name: "Expand" });
    await act(async () => { fireEvent.click(chevron); });

    expect(screen.getByText("Proposed Prompt")).toBeInTheDocument();
    expect(screen.getByText("Previous Prompt")).toBeInTheDocument();
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("Improved prompt text")).toBeInTheDocument();
  });

  it("clicking chevron again collapses the row", async () => {
    renderBox({ fixes: [makeFix()] });

    const chevron = screen.getByRole("button", { name: "Expand" });
    await act(async () => { fireEvent.click(chevron); });
    expect(screen.getByText("Proposed Prompt")).toBeInTheDocument();

    const collapse = screen.getByRole("button", { name: "Collapse" });
    await act(async () => { fireEvent.click(collapse); });
    expect(screen.queryByText("Proposed Prompt")).toBeNull();
  });

  it("shows resolved info when resolved_at is set", async () => {
    renderBox({
      fixes: [
        makeFix({
          resolved_by: "uuid-abc",
          resolved_at: "2024-06-01T12:00:00.000Z",
          status: "accepted",
        }),
      ],
    });
    const chevron = screen.getByRole("button", { name: "Expand" });
    await act(async () => { fireEvent.click(chevron); });
    expect(screen.getByText(/Resolved by uuid-abc/)).toBeInTheDocument();
  });
});

describe("EvalRunsBox — sorting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unresolved entries (null resolved_at) sort above resolved ones", () => {
    const resolved = makeFix({
      ref_id: "fix-resolved",
      criterion_title: "Old Resolved",
      resolved_at: "2024-01-01T00:00:00.000Z",
    });
    const unresolved = makeFix({
      ref_id: "fix-unresolved",
      criterion_title: "Pending One",
      resolved_at: null,
    });
    renderBox({ fixes: [resolved, unresolved] });

    const allText = document.body.textContent ?? "";
    expect(allText.indexOf("Pending One")).toBeLessThan(allText.indexOf("Old Resolved"));
  });
});

describe("EvalRunsBox — optimistic spinner row", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockRunEval.mockResolvedValue({
      status: "started",
      message: "Eval started.",
      projectId: 99,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("shows optimistic spinner row immediately after clicking Run Eval", async () => {
    renderBox({ fixes: [] });
    await clickRunEval();

    expect(screen.getByText("Evaluating…")).toBeInTheDocument();
    // All other columns show "—"
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(4);
    // No expand chevron in optimistic row
    expect(screen.queryByRole("button", { name: "Expand" })).toBeNull();
  });

  it("3-minute timeout clears the optimistic row", async () => {
    renderBox({ fixes: [] });
    await clickRunEval();

    expect(screen.getByText("Evaluating…")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 1000);
      await Promise.resolve();
    });

    expect(screen.queryByText("Evaluating…")).toBeNull();
    expect(screen.getByText("No eval results yet.")).toBeInTheDocument();
  });

  it("polling fires refetch every 10 seconds", async () => {
    renderBox({ fixes: [] });
    await clickRunEval();

    mockRefetch.mockClear();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(mockRefetch).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(mockRefetch).toHaveBeenCalledTimes(2);
  });
});

describe("EvalRunsBox — Pusher completion detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockRunEval.mockResolvedValue({
      status: "started",
      message: "Eval started.",
      projectId: 99,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  async function setupOptimisticRow(runId = "run-abc") {
    renderBox({ fixes: [], runId });
    await clickRunEval();
    expect(screen.getByText("Evaluating…")).toBeInTheDocument();
  }

  it("COMPLETED status clears optimistic row and calls refetch", async () => {
    await setupOptimisticRow();
    mockRefetch.mockClear();

    await act(async () => {
      fakePusher.fire("stakwork-run-update", {
        type: "LEGAL_BENCHMARK_EVAL",
        runId: "run-abc",
        status: "COMPLETED",
      });
      await Promise.resolve();
    });

    expect(screen.queryByText("Evaluating…")).toBeNull();
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("ERROR status clears optimistic row", async () => {
    await setupOptimisticRow();
    mockRefetch.mockClear();

    await act(async () => {
      fakePusher.fire("stakwork-run-update", {
        type: "LEGAL_BENCHMARK_EVAL",
        runId: "run-abc",
        status: "ERROR",
      });
      await Promise.resolve();
    });

    expect(screen.queryByText("Evaluating…")).toBeNull();
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("HALTED status clears optimistic row", async () => {
    await setupOptimisticRow();
    mockRefetch.mockClear();

    await act(async () => {
      fakePusher.fire("stakwork-run-update", {
        type: "LEGAL_BENCHMARK_EVAL",
        runId: "run-abc",
        status: "HALTED",
      });
      await Promise.resolve();
    });

    expect(screen.queryByText("Evaluating…")).toBeNull();
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("wrong runId guard — optimistic row persists, refetch NOT called", async () => {
    await setupOptimisticRow("run-abc");
    mockRefetch.mockClear();

    await act(async () => {
      fakePusher.fire("stakwork-run-update", {
        type: "LEGAL_BENCHMARK_EVAL",
        runId: "other-run",
        status: "COMPLETED",
      });
      await Promise.resolve();
    });

    expect(screen.getByText("Evaluating…")).toBeInTheDocument();
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("wrong type guard — optimistic row persists", async () => {
    await setupOptimisticRow();
    mockRefetch.mockClear();

    await act(async () => {
      fakePusher.fire("stakwork-run-update", {
        type: "LEGAL_BENCHMARK_RUNNER",
        runId: "run-abc",
        status: "COMPLETED",
      });
      await Promise.resolve();
    });

    expect(screen.getByText("Evaluating…")).toBeInTheDocument();
    expect(mockRefetch).not.toHaveBeenCalled();
  });
});

describe("EvalRunsBox — polling fallback via fixes growth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockRunEval.mockResolvedValue({
      status: "started",
      message: "Eval started.",
      projectId: 99,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("clears optimistic row when fixes.length grows past pre-launch snapshot", async () => {
    const { rerender } = renderBox({ fixes: [] });
    await clickRunEval();
    expect(screen.getByText("Evaluating…")).toBeInTheDocument();

    // Simulate fixes arriving
    await act(async () => {
      rerender(
        React.createElement(EvalRunsBox, {
          taskSlug: "antitrust/task-1",
          runId: "run-abc",
          showRunEvalButton: true,
          fixes: [makeFix({ ref_id: "new-fix", criterion_title: "Accuracy" })],
          isLoading: false,
          refetch: mockRefetch,
        }),
      );
      await Promise.resolve();
    });

    expect(screen.queryByText("Evaluating…")).toBeNull();
  });
});

describe("EvalRunsBox — Recursion button", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders Recursion button when showRecursionButton=true", () => {
    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        showRunEvalButton: false,
        showRecursionButton: true,
        fixes: [],
        isLoading: false,
        refetch: mockRefetch,
      }),
    );
    expect(screen.getByRole("button", { name: "Recursion" })).toBeInTheDocument();
  });

  it("does not render Recursion button when showRecursionButton is omitted", () => {
    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        showRunEvalButton: false,
        fixes: [],
        isLoading: false,
        refetch: mockRefetch,
      }),
    );
    expect(screen.queryByRole("button", { name: "Recursion" })).toBeNull();
  });

  it("does not render Recursion button when showRecursionButton=false", () => {
    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        showRunEvalButton: false,
        showRecursionButton: false,
        fixes: [],
        isLoading: false,
        refetch: mockRefetch,
      }),
    );
    expect(screen.queryByRole("button", { name: "Recursion" })).toBeNull();
  });

  it("clicking Recursion button POSTs to the workspace-scoped enable endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;

    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        showRunEvalButton: false,
        showRecursionButton: true,
        fixes: [],
        isLoading: false,
        refetch: mockRefetch,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recursion" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/openlaw/legal/benchmarks/recursion/enable",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskSlug: "antitrust/task-1" }),
      }),
    );
  });

  it("shows success toast on 200 OK response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        showRunEvalButton: false,
        showRecursionButton: true,
        fixes: [],
        isLoading: false,
        refetch: mockRefetch,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recursion" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("Enrolled in recursion loop");
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("shows error toast on non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        showRunEvalButton: false,
        showRecursionButton: true,
        fixes: [],
        isLoading: false,
        refetch: mockRefetch,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recursion" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockToastError).toHaveBeenCalledWith("Failed to enroll");
  });

  it("shows error toast when fetch throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(
      React.createElement(EvalRunsBox, {
        taskSlug: "antitrust/task-1",
        runId: "run-abc",
        showRunEvalButton: false,
        showRecursionButton: true,
        fixes: [],
        isLoading: false,
        refetch: mockRefetch,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recursion" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockToastError).toHaveBeenCalledWith("Failed to enroll");
  });
});

describe("EvalRunsBox — isSuperAdmin / StakworkRunLink", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockRunEval.mockResolvedValue({
      status: "started",
      message: "Eval started.",
      projectId: 99,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not render Stakwork column header when isSuperAdmin=false", () => {
    renderBox({ isSuperAdmin: false });
    expect(screen.queryByText("Stakwork")).toBeNull();
  });

  it("renders Stakwork column header when isSuperAdmin=true", () => {
    renderBox({ isSuperAdmin: true });
    expect(screen.getByText("Stakwork")).toBeInTheDocument();
  });

  it("does not render StakworkRunLink in optimistic row when isSuperAdmin=false", async () => {
    renderBox({ fixes: [], isSuperAdmin: false });
    await clickRunEval();

    expect(screen.getByText("Evaluating…")).toBeInTheDocument();
    expect(screen.queryByText("View on Stakwork")).toBeNull();
  });

  it("renders StakworkRunLink in optimistic row when isSuperAdmin=true after clicking Run Eval", async () => {
    renderBox({ fixes: [], isSuperAdmin: true });
    await clickRunEval();

    expect(screen.getByText("Evaluating…")).toBeInTheDocument();
    expect(screen.getByText("View on Stakwork")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on Stakwork" })).toHaveAttribute(
      "href",
      "https://jobs.stakwork.com/admin/projects/99",
    );
  });

  it("colSpan is 6 for skeleton rows when isSuperAdmin=false", () => {
    renderBox({ isLoading: true, fixes: [], isSuperAdmin: false });
    const skeletonCell = document.querySelector("td[colspan]");
    expect(skeletonCell?.getAttribute("colspan")).toBe("6");
  });

  it("colSpan is 7 for skeleton rows when isSuperAdmin=true", () => {
    renderBox({ isLoading: true, fixes: [], isSuperAdmin: true });
    const skeletonCells = document.querySelectorAll("td[colspan]");
    expect(skeletonCells[0]?.getAttribute("colspan")).toBe("7");
  });

  it("colSpan is 6 for empty-state row when isSuperAdmin=false", () => {
    renderBox({ fixes: [], isLoading: false, isSuperAdmin: false });
    const emptyCell = document.querySelector("td[colspan]");
    expect(emptyCell?.getAttribute("colspan")).toBe("6");
  });

  it("colSpan is 7 for empty-state row when isSuperAdmin=true", () => {
    renderBox({ fixes: [], isLoading: false, isSuperAdmin: true });
    const emptyCell = document.querySelector("td[colspan]");
    expect(emptyCell?.getAttribute("colspan")).toBe("7");
  });

  it("colSpan is 7 for expanded-detail row when isSuperAdmin=true", async () => {
    renderBox({ fixes: [makeFix()], isSuperAdmin: true });

    const chevron = screen.getByRole("button", { name: "Expand" });
    await act(async () => { fireEvent.click(chevron); });

    // Expanded row detail td should have colSpan=7
    const expandedCells = document.querySelectorAll("td[colspan]");
    const expandedCell = Array.from(expandedCells).find(
      (el) => el.getAttribute("colspan") === "7",
    );
    expect(expandedCell).toBeTruthy();
  });

  it("colSpan is 6 for expanded-detail row when isSuperAdmin=false", async () => {
    renderBox({ fixes: [makeFix()], isSuperAdmin: false });

    const chevron = screen.getByRole("button", { name: "Expand" });
    await act(async () => { fireEvent.click(chevron); });

    const expandedCells = document.querySelectorAll("td[colspan]");
    // All colspan values should be 6 (no 7 present)
    const hasSevenColspan = Array.from(expandedCells).some(
      (el) => el.getAttribute("colspan") === "7",
    );
    expect(hasSevenColspan).toBe(false);
    expect(expandedCells[0]?.getAttribute("colspan")).toBe("6");
  });
});
