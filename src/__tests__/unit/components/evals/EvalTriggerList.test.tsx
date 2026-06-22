/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant }: any) => (
    <span data-variant={variant}>{children}</span>
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock("lucide-react", () => ({
  ArrowRight: () => <span>→</span>,
  Check: () => <span>✓</span>,
  ChevronDown: () => <span data-testid="chevron-down">▼</span>,
  ChevronRight: () => <span data-testid="chevron-right">▶</span>,
  Loader2: () => <span data-testid="loader-icon">⟳</span>,
  Play: () => <span>▷</span>,
  X: () => <span>✗</span>,
}));

import { EvalTriggerList } from "@/components/evals/EvalTriggerList";
import { toast } from "sonner";

const DEFAULT_PROPS = {
  evalSetId: "eval-set-1",
  reqId: "req-1",
  slug: "test-ws",
};

const MOCK_TRIGGERS = [
  {
    ref_id: "trigger-1",
    node_type: "EvalTrigger",
    properties: {
      agent: "Code Reviewer",
      start_point: "PR opened",
      end_point: "Review submitted",
      environment: "staging",
      run_count: 3,
    },
    outputs: [],
  },
  {
    ref_id: "trigger-2",
    node_type: "EvalTrigger",
    properties: {
      agent: "Task Agent",
      start_point: "Task created",
      end_point: "Task done",
      environment: "production",
      run_count: 1,
    },
    outputs: [],
  },
];

const MOCK_OUTPUTS = [
  {
    ref_id: "out-1",
    properties: {
      result: "pass",
      score: 0.91,
      attempt_number: 1,
      judge_notes: "Agent response was accurate.",
    },
  },
  {
    ref_id: "out-2",
    properties: {
      result: "fail",
      score: 0.22,
      attempt_number: 2,
      judge_notes: "Agent missed the primary requirement.",
    },
  },
];

describe("EvalTriggerList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders collapsed by default with count chip", () => {
    global.fetch = vi.fn();
    render(<EvalTriggerList {...DEFAULT_PROPS} />);

    expect(screen.getByTestId("trigger-count-chip")).toBeTruthy();
    expect(screen.queryByTestId("trigger-list")).toBeNull();
  });

  it("shows chevron-right when collapsed", () => {
    global.fetch = vi.fn();
    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("chevron-right")).toBeTruthy();
  });

  it("does NOT call fetch on initial render", () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches triggers on first expand", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_TRIGGERS } }),
    });
    global.fetch = fetchMock as any;

    render(<EvalTriggerList {...DEFAULT_PROPS} />);

    await userEvent.click(screen.getByTestId("trigger-count-chip"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/test-ws/evals/eval-set-1/requirements/req-1/triggers",
      );
    });
  });

  it("renders trigger rows after expand", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_TRIGGERS } }),
    });

    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId("trigger-count-chip"));

    await waitFor(() => {
      expect(screen.getAllByTestId("trigger-row")).toHaveLength(2);
    });

    expect(screen.getByText("Code Reviewer")).toBeTruthy();
    expect(screen.getByText("Task Agent")).toBeTruthy();
  });

  it("shows skeleton while loading", async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any;

    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId("trigger-count-chip"));

    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("does NOT re-fetch on second expand toggle", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_TRIGGERS } }),
    });
    global.fetch = fetchMock as any;

    render(<EvalTriggerList {...DEFAULT_PROPS} />);

    // First expand
    await userEvent.click(screen.getByTestId("trigger-count-chip"));
    await waitFor(() => expect(screen.getAllByTestId("trigger-row")).toHaveLength(2));

    // Collapse
    await userEvent.click(screen.getByTestId("trigger-count-chip"));
    expect(screen.queryByTestId("trigger-list")).toBeNull();

    // Second expand
    await userEvent.click(screen.getByTestId("trigger-count-chip"));
    await waitFor(() => expect(screen.getAllByTestId("trigger-row")).toHaveLength(2));

    // Should have been called only once total
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("updates count chip to show trigger count after load", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_TRIGGERS } }),
    });

    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId("trigger-count-chip"));

    await waitFor(() => {
      const chip = screen.getByTestId("trigger-count-chip").textContent ?? "";
      expect(chip).toContain("Triggers");
      expect(chip).toContain("2");
    });
  });

  it("shows empty 'none yet' chip after empty response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: [] } }),
    });

    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId("trigger-count-chip"));

    await waitFor(() => {
      expect(screen.getByTestId("trigger-count-chip").textContent).toContain("none yet");
    });
  });

  it("hides triggers with no agent, start, or end (blank/legacy rows)", async () => {
    const triggersWithBlank = [
      MOCK_TRIGGERS[0],
      {
        ref_id: "trigger-blank",
        node_type: "EvalTrigger",
        properties: { run_count: 1 },
        outputs: [],
      },
    ];
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: triggersWithBlank } }),
    });

    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId("trigger-count-chip"));

    await waitFor(() => {
      expect(screen.getAllByTestId("trigger-row")).toHaveLength(1);
    });
    // Count chip reflects only the visible (identifiable) trigger
    expect(screen.getByTestId("trigger-count-chip").textContent).toContain("1");
  });

  it("hides blank-verdict outputs and numbers attempts sequentially when attempt_number is 0", async () => {
    const triggersWithMixedOutputs = [
      {
        ...MOCK_TRIGGERS[0],
        outputs: [
          {
            ref_id: "o-empty",
            node_type: "EvalTriggerOutput",
            properties: { result: "", score: 0, attempt_number: 0 },
          },
          {
            ref_id: "o-pass",
            node_type: "EvalTriggerOutput",
            properties: { result: "pass", score: 1, attempt_number: 0 },
          },
          {
            ref_id: "o-fail",
            node_type: "EvalTriggerOutput",
            properties: { result: "fail", score: 0, attempt_number: 0 },
          },
        ],
      },
    ];
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: triggersWithMixedOutputs } }),
    });

    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId("trigger-count-chip"));

    await waitFor(() => {
      // The blank-result output is filtered out
      expect(screen.getAllByTestId("trigger-output-row")).toHaveLength(2);
    });

    const rows = screen.getAllByTestId("trigger-output-row");
    expect(rows[0].textContent).toContain("#1");
    expect(rows[1].textContent).toContain("#2");
  });

  it("Run Eval button enters disabled state during execution", async () => {
    let resolveRun!: (val: unknown) => void;
    const runPromise = new Promise((resolve) => { resolveRun = resolve; });

    const fetchMock = vi.fn()
      // triggers fetch
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: MOCK_TRIGGERS } }) })
      // run POST — never resolves until we do
      .mockReturnValueOnce(runPromise as any);
    global.fetch = fetchMock as any;

    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId("trigger-count-chip"));
    await waitFor(() => expect(screen.getAllByTestId("trigger-row")).toHaveLength(2));

    const runBtns = screen.getAllByTestId("run-eval-btn");
    await userEvent.click(runBtns[0]);

    // Button should be disabled while running
    expect(runBtns[0]).toBeDisabled();

    // Other trigger's button should still be enabled
    expect(runBtns[1]).not.toBeDisabled();

    // Resolve the run
    resolveRun({ ok: true, json: async () => ({ success: true, project_id: "proj-1" }) });
  });

  it("renders EvalTriggerOutput rows with attempt_number, pass/fail badge, score, judge_notes", async () => {
    const fetchMock = vi.fn()
      // triggers fetch
      .mockResolvedValueOnce({
        json: async () => ({ data: { nodes: [MOCK_TRIGGERS[0]] } }),
      })
      // run POST
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, project_id: "p1" }) })
      // outputs fetch
      .mockResolvedValueOnce({
        json: async () => ({ data: { nodes: MOCK_OUTPUTS } }),
      });
    global.fetch = fetchMock as any;

    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId("trigger-count-chip"));
    await waitFor(() => expect(screen.getAllByTestId("trigger-row")).toHaveLength(1));

    await userEvent.click(screen.getByTestId("run-eval-btn"));

    await waitFor(() => {
      expect(screen.getAllByTestId("trigger-output-row")).toHaveLength(2);
    });

    // Pass output
    const rows = screen.getAllByTestId("trigger-output-row");
    expect(rows[0].textContent).toContain("#1");
    expect(rows[0].textContent).toContain("pass");
    expect(rows[0].textContent).toContain("0.91");
    expect(rows[0].textContent).toContain("Agent response was accurate.");

    // Fail output
    expect(rows[1].textContent).toContain("#2");
    expect(rows[1].textContent).toContain("fail");
    expect(rows[1].textContent).toContain("0.22");
  });

  it("visually distinguishes pass and fail outputs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: [MOCK_TRIGGERS[0]] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: MOCK_OUTPUTS } }) });
    global.fetch = fetchMock as any;

    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId("trigger-count-chip"));
    await waitFor(() => expect(screen.getAllByTestId("run-eval-btn")).toHaveLength(1));

    await userEvent.click(screen.getByTestId("run-eval-btn"));
    await waitFor(() => expect(screen.getAllByTestId("trigger-output-row")).toHaveLength(2));

    const rows = screen.getAllByTestId("trigger-output-row");
    expect(rows[0].textContent?.toLowerCase()).toContain("pass");
    expect(rows[1].textContent?.toLowerCase()).toContain("fail");

    const html = screen.getByTestId("trigger-list").innerHTML;
    expect(html).toContain("emerald");
    expect(html).toContain("rose");
  });

  it("shows error toast when fetch fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId("trigger-count-chip"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to load triggers");
    });
  });

  it("renders score from embedded outputs loaded via fetchTriggers without crashing", async () => {
    const triggersWithRawOutputs = [
      {
        ...MOCK_TRIGGERS[0],
        outputs: [
          {
            ref_id: "out-embedded",
            node_type: "EvalTriggerOutput",
            properties: { result: "pass", score: 0.75, attempt_number: 1 },
          },
        ],
      },
    ];
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: triggersWithRawOutputs } }),
    });
    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId("trigger-count-chip"));
    await waitFor(() => {
      expect(screen.getAllByTestId("trigger-output-row")).toHaveLength(1);
      expect(screen.getByText("0.75")).toBeTruthy();
    });
  });

  it("renders 0.00 score when score is missing from embedded output properties", async () => {
    const triggersWithUndefinedScore = [
      {
        ...MOCK_TRIGGERS[0],
        outputs: [
          {
            ref_id: "out-no-score",
            node_type: "EvalTriggerOutput",
            properties: { result: "fail", attempt_number: 1 },
          },
        ],
      },
    ];
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: triggersWithUndefinedScore } }),
    });
    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId("trigger-count-chip"));
    await waitFor(() => {
      expect(screen.getByText("0.00")).toBeTruthy();
    });
  });

  it("uses attempt_number field not attempt", async () => {
    const outputWithAttemptNumber = [
      {
        ref_id: "out-x",
        properties: { result: "pass", score: 0.9, attempt_number: 5, judge_notes: "Good" },
      },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: [MOCK_TRIGGERS[0]] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: outputWithAttemptNumber } }) });
    global.fetch = fetchMock as any;

    render(<EvalTriggerList {...DEFAULT_PROPS} />);
    await userEvent.click(screen.getByTestId("trigger-count-chip"));
    await waitFor(() => expect(screen.getAllByTestId("run-eval-btn")).toHaveLength(1));
    await userEvent.click(screen.getByTestId("run-eval-btn"));

    await waitFor(() => {
      expect(screen.getAllByTestId("trigger-output-row")).toHaveLength(1);
    });
    expect(screen.getByTestId("trigger-output-row").textContent).toContain("#5");
  });
});
