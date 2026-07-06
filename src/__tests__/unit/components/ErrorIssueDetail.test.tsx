/**
 * Unit tests for the LikelyCause card in ErrorIssueDetail.
 * Covers:
 *   - High confidence: PR link + commit SHA link rendered correctly.
 *   - "Likely" confidence: candidates listed as "Possibly caused by one of:".
 *   - No correlation: nothing rendered.
 *   - Graceful handling of null fields within a high-confidence result.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock next/navigation (transitively imported)
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// Mock fetch so BlobViewer never fires real requests
vi.stubGlobal("fetch", vi.fn());

import { ErrorIssueDetail } from "@/components/errors/ErrorIssueDetail";
import type {
  ErrorIssueDetailResponse,
  ErrorIssueRecord,
  ErrorEventRecord,
  CorrelationCandidate,
} from "@/types/error-issues";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeIssue(overrides: Partial<ErrorIssueRecord> = {}): ErrorIssueRecord {
  return {
    id: "issue-1",
    workspaceId: "ws-1",
    repositoryId: "repo-1",
    repoKey: "stakwork/hive",
    fingerprint: "fp-1",
    exceptionType: "TypeError",
    title: "Cannot read properties of undefined",
    status: "UNRESOLVED",
    occurrenceCount: 5,
    firstSeenAt: "2026-01-01T00:00:00Z",
    lastSeenAt: "2026-01-15T10:00:00Z",
    environment: "production",
    release: "v1.0.0",
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

function makeEvent(overrides: Partial<ErrorEventRecord> = {}): ErrorEventRecord {
  return {
    id: "evt-1",
    issueId: "issue-1",
    workspaceId: "ws-1",
    repositoryId: "repo-1",
    repoKey: "stakwork/hive",
    exceptionType: "TypeError",
    message: "oops",
    environment: "production",
    release: "v1.0.0",
    fingerprint: "fp-1",
    commitSha: null,
    repositoryUrl: "https://github.com/stakwork/hive",
    defaultBranch: "master",
    createdAt: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

function makeDetail(
  issueOverrides: Partial<ErrorIssueRecord> = {},
  eventOverrides: Partial<ErrorEventRecord> = {},
  features: ErrorIssueDetailResponse["features"] = [],
): ErrorIssueDetailResponse {
  return {
    issue: makeIssue(issueOverrides),
    events: [makeEvent(eventOverrides)],
    eventsTotal: 1,
    eventsHasMore: false,
    features,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("ErrorIssueDetail — LikelyCause card", () => {
  it("renders nothing when correlationConfidence is null", () => {
    render(<ErrorIssueDetail detail={makeDetail()} slug="test-ws" />);
    expect(screen.queryByTestId("likely-cause-card")).not.toBeInTheDocument();
  });

  describe("high confidence", () => {
    const HIGH_ISSUE: Partial<ErrorIssueRecord> = {
      correlationConfidence: "high",
      correlatedPrNumber: 42,
      correlatedPrUrl: "https://github.com/stakwork/hive/pull/42",
      correlatedCommitSha: "abc1234def5678901234567890123456789abcde",
      correlationCandidates: null,
    };

    it("renders the Likely Cause card", () => {
      render(<ErrorIssueDetail detail={makeDetail(HIGH_ISSUE)} slug="test-ws" />);
      expect(screen.getByTestId("likely-cause-card")).toBeInTheDocument();
    });

    it("renders 'Likely Cause' heading", () => {
      render(<ErrorIssueDetail detail={makeDetail(HIGH_ISSUE)} slug="test-ws" />);
      expect(screen.getByText("Likely Cause")).toBeInTheDocument();
    });

    it("renders PR link with correct href and text", () => {
      render(<ErrorIssueDetail detail={makeDetail(HIGH_ISSUE)} slug="test-ws" />);
      const prLink = screen.getByTestId("correlation-pr-link");
      expect(prLink).toHaveTextContent("PR #42");
      expect(prLink).toHaveAttribute("href", "https://github.com/stakwork/hive/pull/42");
      expect(prLink).toHaveAttribute("target", "_blank");
    });

    it("renders commit link with short SHA (7 chars)", () => {
      render(<ErrorIssueDetail detail={makeDetail(HIGH_ISSUE)} slug="test-ws" />);
      const commitEl = screen.getByTestId("correlation-commit-link");
      // Should show only the first 7 chars
      expect(commitEl).toHaveTextContent("abc1234");
      // Full SHA should be in the title tooltip
      expect(commitEl).toHaveAttribute("title", "abc1234def5678901234567890123456789abcde");
    });

    it("builds the commit link URL using the event's repositoryUrl", () => {
      render(
        <ErrorIssueDetail
          detail={makeDetail(HIGH_ISSUE, {
            repositoryUrl: "https://github.com/stakwork/hive",
          })}
          slug="test-ws"
        />,
      );
      const commitLink = screen.getByTestId("correlation-commit-link");
      expect(commitLink).toHaveAttribute(
        "href",
        "https://github.com/stakwork/hive/commit/abc1234def5678901234567890123456789abcde",
      );
    });

    it("renders commit as plain text (no anchor) when no repositoryUrl", () => {
      render(
        <ErrorIssueDetail
          detail={makeDetail(HIGH_ISSUE, { repositoryUrl: null })}
          slug="test-ws"
        />,
      );
      const commitEl = screen.getByTestId("correlation-commit-link");
      expect(commitEl.tagName).not.toBe("A");
      expect(commitEl).toHaveTextContent("abc1234");
    });

    it("omits PR section when correlatedPrNumber is null", () => {
      render(
        <ErrorIssueDetail
          detail={makeDetail({ ...HIGH_ISSUE, correlatedPrNumber: null, correlatedPrUrl: null })}
          slug="test-ws"
        />,
      );
      expect(screen.queryByTestId("correlation-pr-link")).not.toBeInTheDocument();
      // Commit should still show
      expect(screen.getByTestId("correlation-commit-link")).toBeInTheDocument();
    });

    it("omits commit section when correlatedCommitSha is null", () => {
      render(
        <ErrorIssueDetail
          detail={makeDetail({ ...HIGH_ISSUE, correlatedCommitSha: null })}
          slug="test-ws"
        />,
      );
      expect(screen.queryByTestId("correlation-commit-link")).not.toBeInTheDocument();
      // PR should still show
      expect(screen.getByTestId("correlation-pr-link")).toBeInTheDocument();
    });
  });

  describe("likely confidence (multi-candidate)", () => {
    const candidates: CorrelationCandidate[] = [
      { refId: "ref-pr-7", prNumber: 7, prUrl: "https://github.com/stakwork/hive/pull/7", mergeDate: "2026-01-10T00:00:00Z" },
      { refId: "ref-pr-8", prNumber: 8, prUrl: "https://github.com/stakwork/hive/pull/8", mergeDate: "2026-01-11T00:00:00Z" },
    ];

    const LIKELY_ISSUE: Partial<ErrorIssueRecord> = {
      correlationConfidence: "likely",
      correlatedPrNumber: null,
      correlatedPrUrl: null,
      correlatedCommitSha: null,
      correlationCandidates: candidates,
    };

    it("renders the Likely Cause card", () => {
      render(<ErrorIssueDetail detail={makeDetail(LIKELY_ISSUE)} slug="test-ws" />);
      expect(screen.getByTestId("likely-cause-card")).toBeInTheDocument();
    });

    it("shows 'Possibly caused by one of:' label", () => {
      render(<ErrorIssueDetail detail={makeDetail(LIKELY_ISSUE)} slug="test-ws" />);
      expect(screen.getByText("Possibly caused by one of:")).toBeInTheDocument();
    });

    it("renders all candidate PR links", () => {
      render(<ErrorIssueDetail detail={makeDetail(LIKELY_ISSUE)} slug="test-ws" />);
      const cand7 = screen.getByTestId("correlation-candidate-7");
      expect(cand7).toHaveTextContent("PR #7");
      expect(cand7).toHaveAttribute("href", "https://github.com/stakwork/hive/pull/7");
      const cand8 = screen.getByTestId("correlation-candidate-8");
      expect(cand8).toHaveTextContent("PR #8");
    });

    it("renders candidate list container", () => {
      render(<ErrorIssueDetail detail={makeDetail(LIKELY_ISSUE)} slug="test-ws" />);
      expect(screen.getByTestId("correlation-candidates-list")).toBeInTheDocument();
    });

    it("does NOT render the assertive PR link (no single correlation-pr-link)", () => {
      render(<ErrorIssueDetail detail={makeDetail(LIKELY_ISSUE)} slug="test-ws" />);
      expect(screen.queryByTestId("correlation-pr-link")).not.toBeInTheDocument();
    });

    it("handles empty candidates array gracefully", () => {
      render(
        <ErrorIssueDetail
          detail={makeDetail({ ...LIKELY_ISSUE, correlationCandidates: [] })}
          slug="test-ws"
        />,
      );
      // Card still renders (confidence is set), candidates list is empty
      expect(screen.getByTestId("likely-cause-card")).toBeInTheDocument();
      expect(screen.getByTestId("correlation-candidates-list")).toBeInTheDocument();
    });
  });
});

// ── Linked Fixes card ─────────────────────────────────────────────────────────

describe("ErrorIssueDetail — Linked Fixes card", () => {
  it("renders no 'View Plan' links when features is empty", () => {
    render(<ErrorIssueDetail detail={makeDetail()} slug="test-ws" />);
    expect(screen.queryByText("Linked Fixes")).not.toBeInTheDocument();
    expect(screen.queryByText("View Plan")).not.toBeInTheDocument();
  });

  it("renders a 'View Plan' link for each linked feature, newest first", () => {
    const features = [
      { id: "feat-2", title: "Retry Fix", createdAt: "2025-06-01T00:00:00Z" },
      { id: "feat-1", title: "First Fix", createdAt: "2025-01-01T00:00:00Z" },
    ];
    render(<ErrorIssueDetail detail={makeDetail({}, {}, features)} slug="my-workspace" />);

    expect(screen.getByText("Linked Fixes")).toBeInTheDocument();

    const links = screen.getAllByText("View Plan");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/w/my-workspace/plan/feat-2");
    expect(links[1]).toHaveAttribute("href", "/w/my-workspace/plan/feat-1");
  });

  it("shows feature title text for each linked fix", () => {
    const features = [
      { id: "feat-2", title: "Retry Fix", createdAt: "2025-06-01T00:00:00Z" },
      { id: "feat-1", title: "First Fix", createdAt: "2025-01-01T00:00:00Z" },
    ];
    render(<ErrorIssueDetail detail={makeDetail({}, {}, features)} slug="my-workspace" />);
    expect(screen.getByText("Retry Fix")).toBeInTheDocument();
    expect(screen.getByText("First Fix")).toBeInTheDocument();
  });

  it("uses the slug prop to build the correct plan URL", () => {
    const features = [{ id: "feat-99", title: "Some Fix", createdAt: "2025-03-01T00:00:00Z" }];
    render(<ErrorIssueDetail detail={makeDetail({}, {}, features)} slug="acme-org" />);
    const link = screen.getByText("View Plan");
    expect(link).toHaveAttribute("href", "/w/acme-org/plan/feat-99");
  });
});

// ── Impact & affected code card ───────────────────────────────────────────────

describe("ErrorIssueDetail — Impact card", () => {
  const SCORED_META = {
    topNodeName: "edit",
    topNodeType: "Function",
    topPagerank: 0.405,
    nodeCount: 4,
  };

  it("renders the impact card", () => {
    render(
      <ErrorIssueDetail
        detail={makeDetail({ impactScore: 0.405, impactMeta: SCORED_META })}
        slug="test-ws"
      />,
    );
    expect(screen.getByTestId("impact-card")).toBeInTheDocument();
  });

  it("shows 'Medium · 41' badge for score 0.405", () => {
    render(
      <ErrorIssueDetail
        detail={makeDetail({ impactScore: 0.405, impactMeta: SCORED_META })}
        slug="test-ws"
      />,
    );
    expect(screen.getByTestId("impact-badge")).toHaveTextContent("Medium · 41");
  });

  it("shows top affected code node name and type", () => {
    render(
      <ErrorIssueDetail
        detail={makeDetail({ impactScore: 0.405, impactMeta: SCORED_META })}
        slug="test-ws"
      />,
    );
    expect(screen.getByTestId("impact-card")).toHaveTextContent("edit");
    expect(screen.getByTestId("impact-card")).toHaveTextContent("Function");
  });

  it("shows centrality formatted to 2dp", () => {
    render(
      <ErrorIssueDetail
        detail={makeDetail({ impactScore: 0.405, impactMeta: SCORED_META })}
        slug="test-ws"
      />,
    );
    expect(screen.getByTestId("impact-card")).toHaveTextContent("0.41");
  });

  it("shows node count references", () => {
    render(
      <ErrorIssueDetail
        detail={makeDetail({ impactScore: 0.405, impactMeta: SCORED_META })}
        slug="test-ws"
      />,
    );
    expect(screen.getByTestId("impact-card")).toHaveTextContent("4");
  });

  it("shows 'Not yet scored' state when impactScore is null", () => {
    render(
      <ErrorIssueDetail
        detail={makeDetail({ impactScore: null, impactMeta: null })}
        slug="test-ws"
      />,
    );
    expect(screen.getByTestId("impact-not-scored")).toBeInTheDocument();
  });

  it("does NOT show 'Not yet scored' when impactScore is set", () => {
    render(
      <ErrorIssueDetail
        detail={makeDetail({ impactScore: 0.405, impactMeta: SCORED_META })}
        slug="test-ws"
      />,
    );
    expect(screen.queryByTestId("impact-not-scored")).not.toBeInTheDocument();
  });
});
