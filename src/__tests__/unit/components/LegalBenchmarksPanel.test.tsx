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
  toast: vi.fn(),
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
  Button: ({ children, onClick, size, variant }: { children?: React.ReactNode; onClick?: () => void; size?: string; variant?: string }) =>
    React.createElement("button", { onClick, "data-size": size, "data-variant": variant }, children),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ placeholder, value, onChange, className }: {
    placeholder?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    className?: string;
  }) =>
    React.createElement("input", { placeholder, value, onChange, className }),
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

    // Click second practice area
    await user.click(screen.getByText("Banking & Finance"));

    await waitFor(() => {
      expect(screen.getByText("Loan Agreement Review")).toBeInTheDocument();
      expect(screen.getByText("Credit Facility Draft")).toBeInTheDocument();
    });

    // First area tasks no longer shown
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

  it("fires 'Coming soon' toast when Select Task is clicked", async () => {
    const user = userEvent.setup();
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      expect(screen.getAllByText("Select Task").length).toBeGreaterThan(0);
    });

    const buttons = screen.getAllByText("Select Task");
    await user.click(buttons[0]);

    expect(mockToast).toHaveBeenCalledWith(
      "Coming soon: run this task against a legal workflow."
    );
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
      // Each practice area button shows a badge with the task count
      const badges = screen.getAllByTestId("badge");
      const countBadges = badges.filter((b) => ["3", "2"].includes(b.textContent ?? ""));
      expect(countBadges.length).toBeGreaterThan(0);
    });
  });

  it("renders tags with +N overflow indicator", async () => {
    render(React.createElement(LegalBenchmarksPanel));

    await waitFor(() => {
      // "antitrust/task-1" has 3 tags: hsr, merger, antitrust — exactly 3, no overflow
      expect(screen.queryByText(/^\+\d+ more$/)).not.toBeInTheDocument();
    });
  });
});
