/**
 * Unit tests for ErrorStatusBadge and ErrorIssuesTable filtering logic
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorStatusBadge } from "@/components/errors/ErrorStatusBadge";
import { ErrorIssuesTable } from "@/components/errors/ErrorIssuesTable";
import type { ErrorIssueRecord } from "@/types/error-issues";

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

  it("renders impact indicator badge for a scored issue", () => {
    const issues = [makeIssue("a", { impactScore: 0.85 })];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    const indicator = screen.getByTestId("impact-indicator");
    expect(indicator).toBeInTheDocument();
    expect(indicator.textContent).toBe("85");
  });

  it("renders low impact score correctly", () => {
    const issues = [makeIssue("a", { impactScore: 0.2 })];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    const indicator = screen.getByTestId("impact-indicator");
    expect(indicator.textContent).toBe("20");
  });

  it("renders — (muted) when impactScore is null", () => {
    const issues = [makeIssue("a", { impactScore: null })];
    render(
      <ErrorIssuesTable issues={issues} loading={false} error={null} onRowClick={vi.fn()} />,
    );
    // null score shows muted dash (in addition to env dash if env is set)
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
    expect(screen.queryByTestId("impact-indicator")).toBeNull();
  });

  it("renders impact meta tooltip title when impactMeta has topNodeName", () => {
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
    expect(indicator.title).toBe("Top node: src/core/auth.ts");
  });

  it("skeleton loading has 9 columns matching table header", () => {
    const { container } = render(
      <ErrorIssuesTable issues={[]} loading={true} error={null} onRowClick={vi.fn()} />,
    );
    // Header row should have 9 <th> elements
    const headerCells = container.querySelectorAll("thead th");
    expect(headerCells).toHaveLength(9);

    // Each skeleton row should also have 9 <td> cells
    const firstSkeletonRow = container.querySelector("tbody tr");
    expect(firstSkeletonRow).not.toBeNull();
    const skeletonCells = firstSkeletonRow!.querySelectorAll("td");
    expect(skeletonCells).toHaveLength(9);
  });
});
