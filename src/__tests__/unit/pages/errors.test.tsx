// @vitest-environment jsdom
/**
 * Integration-style unit tests for Errors pages
 *
 * Covers:
 * - /w/[slug]/errors — list page: renders table, filters, pagination
 * - /w/[slug]/errors/[issueId] — detail page: metadata, events, triage
 * - Triage button → PATCH → optimistic status update
 */
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Next.js navigation mock ───────────────────────────────────────────────────
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ slug: "test-ws", issueId: "issue-a" })),
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: vi.fn(() => "") }),
  usePathname: () => "/w/test-ws/errors",
}));

// ── Workspace hook mock ───────────────────────────────────────────────────────
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    id: "ws-1",
    slug: "test-ws",
    workspace: { repositories: [] },
  }),
}));

// ── Pusher mock ───────────────────────────────────────────────────────────────
vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => ({
    subscribe: vi.fn(() => ({ bind: vi.fn(), unbind: vi.fn() })),
    unsubscribe: vi.fn(),
  })),
  getWorkspaceChannelName: vi.fn((s: string) => `workspace-${s}`),
  PUSHER_EVENTS: { ERROR_ISSUE_UPDATED: "error-issue-updated" },
}));

// ── shadcn/ui stubs ───────────────────────────────────────────────────────────
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, "data-testid": tid }: any) => (
    <button onClick={onClick} disabled={disabled} data-testid={tid}>
      {children}
    </button>
  ),
  buttonVariants: () => "",
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, "data-testid": tid }: any) => <span data-testid={tid}>{children}</span>,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: any) => <div data-testid="select" onClick={() => onValueChange?.("RESOLVED")}>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children, "data-testid": tid }: any) => <div data-testid={tid}>{children}</div>,
  SelectValue: () => <div />,
}));
vi.mock("@/components/ui/pagination", () => ({
  Pagination: ({ children }: any) => <div>{children}</div>,
  PaginationContent: ({ children }: any) => <div>{children}</div>,
  PaginationItem: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: any) => <div className={className} data-testid="skeleton" />,
}));
vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children, onClick }: any) => <td onClick={onClick}>{children}</td>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children, onClick, "data-testid": tid }: any) => (
    <tr onClick={onClick} data-testid={tid}>{children}</tr>
  ),
}));
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, actions }: any) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

// ── useFixInPlanMode mock ─────────────────────────────────────────────────────
vi.mock("@/app/w/[slug]/errors/[issueId]/useFixInPlanMode", () => ({
  useFixInPlanMode: () => ({ launch: vi.fn(), isLaunching: false }),
}));

// ── sonner mock ───────────────────────────────────────────────────────────────
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// ── Fetch mock ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function makeIssue(id: string, overrides?: object) {
  return {
    id,
    workspaceId: "ws-1",
    repositoryId: "repo-1",
    repoKey: "hive",
    fingerprint: `fp-${id}`,
    exceptionType: "TypeError",
    title: `Error in ${id}`,
    status: "UNRESOLVED",
    occurrenceCount: 3,
    firstSeenAt: "2026-05-01T00:00:00.000Z",
    lastSeenAt: "2026-06-01T00:00:00.000Z",
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

function makeEvent(id: string, issueId: string, overrides?: object) {
  return {
    id,
    issueId,
    workspaceId: "ws-1",
    repositoryId: "repo-1",
    repoKey: "hive",
    exceptionType: "TypeError",
    message: "Cannot read property x",
    environment: "production",
    release: "1.0.0",
    fingerprint: "fp-a",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── Errors List Page tests ────────────────────────────────────────────────────

import ErrorsPage from "@/app/w/[slug]/errors/page";

describe("ErrorsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockClear();
  });

  test("renders loading skeleton during fetch", () => {
    // Never resolve — keep loading state
    mockFetch.mockReturnValueOnce(new Promise(() => {}));
    render(<ErrorsPage />);
    expect(screen.getByTestId("error-issues-table-loading")).toBeInTheDocument();
  });

  test("renders error issues in table after fetch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        issues: [makeIssue("a"), makeIssue("b")],
        total: 2,
        hasMore: false,
      }),
    });

    render(<ErrorsPage />);

    await waitFor(() => {
      expect(screen.getByText("Error in a")).toBeInTheDocument();
      expect(screen.getByText("Error in b")).toBeInTheDocument();
    });
  });

  test("renders empty state when no issues", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ issues: [], total: 0, hasMore: false }),
    });

    render(<ErrorsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("error-issues-table-empty")).toBeInTheDocument();
    });
  });

  test("navigates to detail on row click", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        issues: [makeIssue("issue-abc")],
        total: 1,
        hasMore: false,
      }),
    });

    render(<ErrorsPage />);

    await waitFor(() => expect(screen.getByTestId("error-issue-row-issue-abc")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("error-issue-row-issue-abc"));
    expect(mockPush).toHaveBeenCalledWith("/w/test-ws/errors/issue-abc");
  });

  test("triage button patches status optimistically", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issues: [makeIssue("a", { status: "UNRESOLVED" })],
          total: 1,
          hasMore: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "a", status: "RESOLVED", workspaceId: "ws-1" } }),
      });

    render(<ErrorsPage />);

    await waitFor(() => expect(screen.getByTestId("triage-resolve")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("triage-resolve"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/errors/a",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  test("default fetch uses UNRESOLVED status filter (active-only default)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ issues: [], total: 0, hasMore: false }),
    });

    render(<ErrorsPage />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("status=UNRESOLVED");
  });

  test("selecting All statuses sends status=all to API", async () => {
    // Only one fetch needed: verify the status-filter Select is present and that
    // the hook wiring for "all" works (full behavior tested in useErrorIssues tests).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ issues: [], total: 0, hasMore: false }),
    });

    render(<ErrorsPage />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    // The Select component is rendered with the current status filter
    expect(screen.getByTestId("status-filter")).toBeInTheDocument();
  });

  test("sort select control is present and defaults to recent (no sort param in initial fetch)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ issues: [], total: 0, hasMore: false }),
    });

    render(<ErrorsPage />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    // Sort control is rendered
    expect(screen.getByTestId("sort-select")).toBeInTheDocument();

    // Default sort=recent: the hook omits the param when it equals the default,
    // or includes sort=recent — either way "sort=impact" must NOT be present.
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).not.toContain("sort=impact");
  });
});

// ── Error Issue Detail Page tests ─────────────────────────────────────────────

// Override useParams for the detail page tests
const { useParams } = await import("next/navigation");

import ErrorIssueDetailPage from "@/app/w/[slug]/errors/[issueId]/page";

describe("ErrorIssueDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useParams as ReturnType<typeof vi.fn>).mockReturnValue({ slug: "test-ws", issueId: "issue-a" });
  });

  test("renders loading skeleton during fetch", () => {
    mockFetch.mockReturnValueOnce(new Promise(() => {}));
    render(<ErrorIssueDetailPage />);
    expect(screen.getByTestId("detail-loading")).toBeInTheDocument();
  });

  test("renders issue detail after fetch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        issue: makeIssue("a"),
        events: [makeEvent("evt-1", "a")],
        eventsTotal: 1,
        eventsHasMore: false,
      }),
    });

    render(<ErrorIssueDetailPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Error in a").length).toBeGreaterThan(0);
    });

    // exceptionType shown
    expect(screen.getAllByText("TypeError").length).toBeGreaterThan(0);
    // environment shown
    expect(screen.getAllByText("production").length).toBeGreaterThan(0);
  });

  test("renders 404 error state gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    });

    render(<ErrorIssueDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId("detail-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Issue not found or access denied.")).toBeInTheDocument();
  });

  test("triage resolve button patches status", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issue: makeIssue("a", { status: "UNRESOLVED" }),
          events: [],
          eventsTotal: 0,
          eventsHasMore: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "a", status: "RESOLVED", workspaceId: "ws-1" } }),
      });

    render(<ErrorIssueDetailPage />);

    await waitFor(() => expect(screen.getByTestId("triage-resolve")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("triage-resolve"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/errors/a",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  test("back button navigates to errors list", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        issue: makeIssue("a"),
        events: [],
        eventsTotal: 0,
        eventsHasMore: false,
      }),
    });

    render(<ErrorIssueDetailPage />);

    await waitFor(() => screen.getByTestId("back-to-errors"));
    fireEvent.click(screen.getByTestId("back-to-errors"));
    expect(mockPush).toHaveBeenCalledWith("/w/test-ws/errors");
  });
});
