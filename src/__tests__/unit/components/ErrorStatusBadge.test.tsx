/**
 * Unit tests for ErrorStatusBadge and ErrorIssuesTable filtering logic
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorStatusBadge } from "@/components/errors/ErrorStatusBadge";
import { ErrorIssuesTable } from "@/components/errors/ErrorIssuesTable";
import type { ErrorIssueRecord } from "@/types/error-issues";
import { IMPACT_EXPLANATION } from "@/lib/utils/impact-tier";

// ── ErrorStatusBadge ──────────────────────────────────────────────────────────

describe("ErrorStatusBadge", () => {
  it("renders 'Unresolved' for UNRESOLVED status", () => {
    render(<ErrorStatusBadge status="UNRESOLVED" />);
    expect(screen.getByText("Unresolved")).toBeInTheDocument();
  });

  it("renders 'Resolved' for RESOLVED status", () => {
    render(<ErrorStatusBadge status="RESOLVED" />);
    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });

  it("renders 'Ignored' for IGNORED status", () => {
    render(<ErrorStatusBadge status="IGNORED" />);
    expect(screen.getByText("Ignored")).toBeInTheDocument();
  });

  it("has the data-testid attribute", () => {
    render(<ErrorStatusBadge status="UNRESOLVED" />);
    expect(screen.getByTestId("error-status-badge")).toBeInTheDocument();
  });
});

// ── ErrorIssuesTable ──────────────────────────────────────────────────────────

function makeIssue(id: string, overrides?: Partial<ErrorIssueRecord>): ErrorIssueRecord {
  return {
    id,
    workspaceId: "ws-1",
    repositoryId: "repo-1",
    repoKey: "hive",
    fingerprint: `fp-${id}`,
    exceptionType: "TypeError",
    title: `Error: cannot read property of undefined (${id})`,
    status: "UNRESOLVED",
    occurrenceCount: 3,
    firstSeenAt: "2026-05-01T00:00:00Z",
    lastSeenAt: "2026-06-01T00:00:00Z",
    environment: "production",
    release: "1.0.0",
    metadata: null,
    kgRefId: null,
    correlatedPrNumber: null,
    correlatedPrUrl: null,
    correlatedCommitSha: null,
    correlationConfidence: null,
    correlationComputedAt: null,
    correlationCandidates: null,
    impactScore: null,
    impactScoredAt: null,
    impactMeta: null,
    ...overrides,
  };
}

describe("ErrorIssuesTable", () => {
  it("renders loading skeleton when loading=true", () => {
    render(
      <ErrorIssuesTable
        issues={[]}
        loading={true}
        error={null}
        onRowClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("error-issues-table-loading")).toBeInTheDocument();
  });

  it("renders error message when error is set", () => {
    render(
      <ErrorIssuesTable
        issues={[]}
        loading={false}
        error="Something went wrong"
        onRowClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("error-issues-table-error")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders empty state when no issues", () => {
    render(
      <ErrorIssuesTable
        issues={[]}
        loading={false}
        error={null}
        onRowClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("error-issues-table-empty")).toBeInTheDocument();
  });

  it("renders a row for each issue", () => {
    const issues = [makeIssue("a"), makeIssue("b"), makeIssue("c")];
    render(
      <ErrorIssuesTable
        issues={issues}
        loading={false}
        error={null}
        onRowClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("error-issue-row-a")).toBeInTheDocument();
    expect(screen.getByTestId("error-issue-row-b")).toBeInTheDocument();
    expect(screen.getByTestId("error-issue-row-c")).toBeInTheDocument();
  });

  it("renders status badge for each issue", () => {
    const issues = [
      makeIssue("a", { status: "UNRESOLVED" }),
      makeIssue("b", { status: "RESOLVED" }),
      makeIssue("c", { status: "IGNORED" }),
    ];
    render(
      <ErrorIssuesTable
        issues={issues}
        loading={false}
        error={null}
        onRowClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Unresolved")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Ignored")).toBeInTheDocument();
  });

  it("calls onRowClick with the issue id when a row is clicked", async () => {
    const onRowClick = vi.fn();
    const issues = [makeIssue("issue-123")];
    const { getByTestId } = render(
      <ErrorIssuesTable
        issues={issues}
        loading={false}
        error={null}
        onRowClick={onRowClick}
      />,
    );
    getByTestId("error-issue-row-issue-123").click();
    expect(onRowClick).toHaveBeenCalledWith("issue-123");
  });

  it("renders occurrence count as a number", () => {
    const issues = [makeIssue("a", { occurrenceCount: 42 })];
    render(
      <ErrorIssuesTable
        issues={issues}
        loading={false}
        error={null}
        onRowClick={vi.fn()}
      />,
    );
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders environment when present", () => {
    const issues = [makeIssue("a", { environment: "staging" })];
    render(
      <ErrorIssuesTable
        issues={issues}
        loading={false}
        error={null}
        onRowClick={vi.fn()}
      />,
    );
    expect(screen.getByText("staging")).toBeInTheDocument();
  });

  it("renders dash when environment is null", () => {
    const issues = [makeIssue("a", { environment: null })];
    render(
      <ErrorIssuesTable
        issues={issues}
        loading={false}
        error={null}
        onRowClick={vi.fn()}
      />,
    );
    // At least one — (environment dash); impactScore is also null so two are expected
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  // ── Impact column tests ──────────────────────────────────────────────────

  it("renders Impact column header in the table", () => {
    const issues = [makeIssue("a")];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    expect(screen.getByText("Impact")).toBeInTheDocument();
  });

  it("renders High impact badge for a scored issue (0.85 → High · 85)", () => {
    const issues = [makeIssue("a", { impactScore: 0.85 })];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    const indicator = screen.getByTestId("impact-indicator");
    expect(indicator).toBeInTheDocument();
    expect(indicator.textContent).toBe("High · 85");
  });

  it("renders Medium impact badge for score 0.41 (Medium · 41)", () => {
    const issues = [makeIssue("a", { impactScore: 0.41 })];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    const indicator = screen.getByTestId("impact-indicator");
    expect(indicator.textContent).toBe("Medium · 41");
  });

  it("renders Low impact badge for a low score (0.2 → Low · 20)", () => {
    const issues = [makeIssue("a", { impactScore: 0.2 })];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    const indicator = screen.getByTestId("impact-indicator");
    expect(indicator.textContent).toBe("Low · 20");
  });

  it("renders 'Not scored' state when impactScore is null", () => {
    const issues = [makeIssue("a", { impactScore: null })];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    const indicator = screen.getByTestId("impact-indicator");
    expect(indicator).toBeInTheDocument();
    expect(indicator.textContent).toBe("Not scored");
  });

  it("badge exposes aria-label for scored issues", () => {
    const issues = [makeIssue("a", { impactScore: 0.85 })];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    const indicator = screen.getByTestId("impact-indicator");
    expect(indicator.getAttribute("aria-label")).toBe("Impact: High, 85 out of 100");
  });

  it("badge exposes aria-label for null score", () => {
    const issues = [makeIssue("a", { impactScore: null })];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    const indicator = screen.getByTestId("impact-indicator");
    expect(indicator.getAttribute("aria-label")).toBe("Impact: Not scored");
  });

  it("renders enriched tooltip title when impactMeta has full data", () => {
    const issues = [
      makeIssue("a", {
        impactScore: 0.9,
        impactMeta: {
          topNodeName: "src/core/auth.ts",
          topNodeType: "Function",
          topPagerank: 0.9,
          nodeCount: 3,
        },
      }),
    ];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    const indicator = screen.getByTestId("impact-indicator");
    expect(indicator.title).toContain("Most-connected code touched:");
    expect(indicator.title).toContain("src/core/auth.ts (Function)");
    expect(indicator.title).toContain("centrality 0.90");
    expect(indicator.title).toContain("3 code locations referenced");
  });

  it("renders tooltip without 'Top node:' prefix (legacy format removed)", () => {
    const issues = [
      makeIssue("a", {
        impactScore: 0.9,
        impactMeta: { topNodeName: "src/core/auth.ts" },
      }),
    ];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    const indicator = screen.getByTestId("impact-indicator");
    expect(indicator.title).not.toContain("Top node:");
  });

  it("skeleton loading has 10 columns matching table header", () => {
    const { container } = render(
      <ErrorIssuesTable issues={[]} loading={true} error={null} onRowClick={vi.fn()} />,
    );
    // Header row should have 10 <th> elements (includes correlation indicator column)
    const headerCells = container.querySelectorAll("thead th");
    expect(headerCells).toHaveLength(10);

    // Each skeleton row should also have 10 <td> cells
    const firstSkeletonRow = container.querySelector("tbody tr");
    expect(firstSkeletonRow).not.toBeNull();
    const skeletonCells = firstSkeletonRow!.querySelectorAll("td");
    expect(skeletonCells).toHaveLength(10);
  });

  // ── Correlation indicator ──────────────────────────────────────────────────

  it("shows correlation indicator icon when correlationConfidence is set", () => {
    const issues = [makeIssue("a", { correlationConfidence: "high" })];
    render(
      <ErrorIssuesTable
        issues={issues}
        loading={false}
        error={null}
        onRowClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("correlation-indicator-a")).toBeInTheDocument();
  });

  it("shows correlation indicator for 'likely' confidence as well", () => {
    const issues = [makeIssue("b", { correlationConfidence: "likely" })];
    render(
      <ErrorIssuesTable
        issues={issues}
        loading={false}
        error={null}
        onRowClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("correlation-indicator-b")).toBeInTheDocument();
  });

  it("does NOT show correlation indicator when correlationConfidence is null", () => {
    const issues = [makeIssue("c", { correlationConfidence: null })];
    render(
      <ErrorIssuesTable
        issues={issues}
        loading={false}
        error={null}
        onRowClick={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("correlation-indicator-c")).not.toBeInTheDocument();
  });

  it("shows indicator only on correlated issues in a mixed list", () => {
    const issues = [
      makeIssue("corr", { correlationConfidence: "high" }),
      makeIssue("none", { correlationConfidence: null }),
    ];
    render(
      <ErrorIssuesTable
        issues={issues}
        loading={false}
        error={null}
        onRowClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("correlation-indicator-corr")).toBeInTheDocument();
    expect(screen.queryByTestId("correlation-indicator-none")).not.toBeInTheDocument();
  });

  // ── Impact column info popover ────────────────────────────────────────────

  it("renders a '?' info button next to the Impact column header", () => {
    const issues = [makeIssue("a")];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    const helpButton = screen.getByRole("button", { name: "What does Impact mean?" });
    expect(helpButton).toBeInTheDocument();
  });

  it("shows IMPACT_EXPLANATION in popover after clicking the '?' button", () => {
    const issues = [makeIssue("a")];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    const helpButton = screen.getByRole("button", { name: "What does Impact mean?" });
    fireEvent.click(helpButton);
    expect(screen.getByText(IMPACT_EXPLANATION)).toBeInTheDocument();
  });
});
