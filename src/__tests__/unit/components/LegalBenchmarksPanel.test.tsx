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
  useWorkspace: () => ({ slug: "openlaw" }),
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

// Mock LegalBenchmarkResults to avoid deep rendering
vi.mock("@/components/legal/LegalBenchmarkResults", () => ({
  LegalBenchmarkResults: ({
    runId,
    onReset,
  }: {
    runId: string;
    onReset: () => void;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "legal-benchmark-results", "data-run-id": runId },
      React.createElement("button", { onClick: onReset }, "Reset")
    ),
}));

// ─── Mock fetch ──────────────────────────────────────────────────────────────

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LegalBenchmarksPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_RESPONSE,
      })
    );
  });

  it("shows skeleton while loading", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise(() => {})) // never resolves
    );
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

    // First call: fetch tasks; second call: POST /run
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_RESPONSE,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ run_id: "run-abc" }),
      });

    vi.stubGlobal("fetch", mockFetch);

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Select Task").length).toBeGreaterThan(0);
    });

    const buttons = screen.getAllByText("Select Task");
    await user.click(buttons[0]);

    await waitFor(() => {
      expect(screen.getByTestId("legal-benchmark-results")).toBeInTheDocument();
    });

    // POST /run was called
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workspaces/openlaw/legal/benchmarks/run",
      expect.objectContaining({ method: "POST" })
    );

    // Results panel shows with correct runId
    expect(screen.getByTestId("legal-benchmark-results")).toHaveAttribute(
      "data-run-id",
      "run-abc"
    );
  });

  it("shows toast.error when POST /run returns 409", async () => {
    const user = userEvent.setup();

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_RESPONSE,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: "A run is already in progress for this task" }),
      });

    vi.stubGlobal("fetch", mockFetch);

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Select Task").length).toBeGreaterThan(0);
    });

    const buttons = screen.getAllByText("Select Task");
    await user.click(buttons[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        "A run is already in progress for this task"
      );
    });

    // Results panel should NOT be shown
    expect(screen.queryByTestId("legal-benchmark-results")).not.toBeInTheDocument();
  });

  it("shows toast.error on generic POST /run failure", async () => {
    const user = userEvent.setup();

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_RESPONSE,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: null }),
      });

    vi.stubGlobal("fetch", mockFetch);

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

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_RESPONSE,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ run_id: "run-abc" }),
      });

    vi.stubGlobal("fetch", mockFetch);

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Select Task").length).toBeGreaterThan(0);
    });

    const buttons = screen.getAllByText("Select Task");
    // Click the first task card button
    await user.click(buttons[0]);

    await waitFor(() => {
      expect(screen.getByTestId("legal-benchmark-results")).toBeInTheDocument();
    });

    // The running card should show "Running…" and be disabled
    expect(screen.getByText("Running…")).toBeInTheDocument();
    const runningBtn = screen.getByText("Running…").closest("button");
    expect(runningBtn).toBeDisabled();

    // Other "Select Task" buttons should still be enabled
    const remainingSelectButtons = screen.getAllByText("Select Task");
    remainingSelectButtons.forEach((btn) => {
      expect(btn.closest("button")).not.toBeDisabled();
    });
  });

  it("hides results panel and re-enables button when onReset is called", async () => {
    const user = userEvent.setup();

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_RESPONSE,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ run_id: "run-abc" }),
      });

    vi.stubGlobal("fetch", mockFetch);

    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Select Task").length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText("Select Task")[0]);

    await waitFor(() => {
      expect(screen.getByTestId("legal-benchmark-results")).toBeInTheDocument();
    });

    // Trigger reset from the results panel
    await user.click(screen.getByText("Reset"));

    await waitFor(() => {
      expect(screen.queryByTestId("legal-benchmark-results")).not.toBeInTheDocument();
    });

    // All buttons should now be "Select Task" again
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "Server error" }),
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
});
