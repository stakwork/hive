/**
 * Unit tests for the BlobViewer / StackTraceViewer rendering in ErrorIssueDetail.
 * Asserts:
 *   - Resolvable frames render as <a> links with the correct GitHub blob URL.
 *   - Unresolvable frames (node_modules, anonymous) render as plain text (no anchor).
 *   - ref precedence: commitSha → release-SHA → defaultBranch → "main".
 *   - Existing loading / error / empty states are preserved.
 */
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock fetch so we control what the blob endpoint returns
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock next/navigation (imported transitively)
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// ---------------------------------------------------------------------------
// Import component under test AFTER mocks are set up
// ---------------------------------------------------------------------------
import { ErrorIssueDetail } from "@/components/errors/ErrorIssueDetail";
import type { ErrorIssueDetailResponse, ErrorEventRecord } from "@/types/error-issues";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<ErrorEventRecord> = {}): ErrorEventRecord {
  return {
    id: "evt-1",
    issueId: "issue-1",
    workspaceId: "ws-1",
    repositoryId: "repo-1",
    repoKey: "stakwork/hive",
    exceptionType: "TypeError",
    message: "Cannot read properties of undefined",
    environment: "production",
    release: "v1.0.0",
    fingerprint: "fp-1",
    commitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    repositoryUrl: "https://github.com/stakwork/hive",
    defaultBranch: "master",
    createdAt: new Date("2025-01-15T10:00:00Z").toISOString(),
    ...overrides,
  };
}

function makeDetail(event: ErrorEventRecord): ErrorIssueDetailResponse {
  return {
    issue: {
      id: "issue-1",
      workspaceId: "ws-1",
      repositoryId: "repo-1",
      repoKey: "stakwork/hive",
      fingerprint: "fp-1",
      exceptionType: "TypeError",
      title: "Cannot read properties of undefined",
      status: "UNRESOLVED",
      occurrenceCount: 5,
      firstSeenAt: new Date("2025-01-01T00:00:00Z").toISOString(),
      lastSeenAt: new Date("2025-01-15T10:00:00Z").toISOString(),
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
    },
    events: [event],
    eventsTotal: 1,
    eventsHasMore: false,
  };
}

const SAMPLE_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'map')",
  "    at ProductList (/app/components/ProductList.tsx:42:18)",
  "    at renderWithHooks (/app/node_modules/react-dom/cjs/react-dom.development.js:14985:18)",
  "    at middleware (/app/middleware.ts:19:20)",
].join("\n");

function makeBlobJson(stackTrace: string = SAMPLE_STACK): string {
  return JSON.stringify({ exceptionType: "TypeError", message: "oops", stackTrace });
}

async function expandEvent(eventId: string) {
  const toggle = screen.getByTestId(`event-toggle-${eventId}`);
  fireEvent.click(toggle);
  // Wait for the blob container AND for loading to finish (skeleton gone)
  await waitFor(() => {
    const container = screen.getByTestId(`event-blob-${eventId}`);
    const skeleton = container.querySelector(".animate-pulse");
    if (skeleton) throw new Error("Still loading");
    return container;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BlobViewer — stack trace rendering", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  test("resolvable frames render as anchor links with correct GitHub URL (commitSha path)", async () => {
    const event = makeEvent();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => makeBlobJson(),
      json: async () => ({}),
    });

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    await expandEvent("evt-1");

    // The resolvable app frames should be links
    const links = screen.getAllByRole("link");
    const productListLink = links.find((l) =>
      (l as HTMLAnchorElement).href.includes("components/ProductList.tsx")
    ) as HTMLAnchorElement | undefined;

    expect(productListLink).toBeDefined();
    expect(productListLink!.href).toBe(
      "https://github.com/stakwork/hive/blob/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2/components/ProductList.tsx#L42"
    );
    expect(productListLink!.target).toBe("_blank");
    expect(productListLink!.rel).toContain("noopener");
  });

  test("node_modules frames render as plain text (not a link)", async () => {
    const event = makeEvent();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => makeBlobJson(),
      json: async () => ({}),
    });

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    await expandEvent("evt-1");

    const links = screen.getAllByRole("link");
    const nodeModulesLink = links.find((l) =>
      (l as HTMLAnchorElement).href.includes("node_modules")
    );
    expect(nodeModulesLink).toBeUndefined();

    // But the text should still appear
    expect(screen.getByText(/node_modules/, { exact: false })).toBeInTheDocument();
  });

  test("falls back to release SHA when commitSha is null and release looks like a SHA", async () => {
    const releaseSha = "deadbeef1234567890abcdef12345678deadbeef";
    const event = makeEvent({ commitSha: null, release: releaseSha });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => makeBlobJson(),
      json: async () => ({}),
    });

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    await expandEvent("evt-1");

    const links = screen.getAllByRole("link");
    const appLink = links.find((l) =>
      (l as HTMLAnchorElement).href.includes("components/ProductList.tsx")
    ) as HTMLAnchorElement | undefined;

    expect(appLink).toBeDefined();
    expect(appLink!.href).toContain(`/blob/${releaseSha}/`);
  });

  test("falls back to defaultBranch when commitSha and release-SHA are absent", async () => {
    const event = makeEvent({ commitSha: null, release: "v2.0.0", defaultBranch: "main" });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => makeBlobJson(),
      json: async () => ({}),
    });

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    await expandEvent("evt-1");

    const links = screen.getAllByRole("link");
    const appLink = links.find((l) =>
      (l as HTMLAnchorElement).href.includes("components/ProductList.tsx")
    ) as HTMLAnchorElement | undefined;

    expect(appLink).toBeDefined();
    expect(appLink!.href).toContain("/blob/main/");
  });

  test("falls back to 'main' when commitSha, release, and defaultBranch are all null", async () => {
    const event = makeEvent({ commitSha: null, release: null, defaultBranch: null });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => makeBlobJson(),
      json: async () => ({}),
    });

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    await expandEvent("evt-1");

    const links = screen.getAllByRole("link");
    const appLink = links.find((l) =>
      (l as HTMLAnchorElement).href.includes("components/ProductList.tsx")
    ) as HTMLAnchorElement | undefined;

    expect(appLink).toBeDefined();
    expect(appLink!.href).toContain("/blob/main/");
  });

  test("no links rendered when repositoryUrl is null", async () => {
    const event = makeEvent({ repositoryUrl: null });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => makeBlobJson(),
      json: async () => ({}),
    });

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    await expandEvent("evt-1");

    // No anchor links should be present (queryAllByRole won't throw when empty)
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    // But the raw frame text is still rendered
    expect(screen.getByText(/ProductList/, { exact: false })).toBeInTheDocument();
  });

  test("handles plain-text blob (non-JSON) gracefully as raw text", async () => {
    const event = makeEvent();
    const rawText = "TypeError: oops\n    at foo (bar.ts:1:1)";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => rawText,
      json: async () => ({}),
    });

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    await expandEvent("evt-1");

    // bar.ts is resolvable
    const links = screen.getAllByRole("link");
    const barLink = links.find((l) =>
      (l as HTMLAnchorElement).href.includes("bar.ts")
    );
    expect(barLink).toBeDefined();
  });

  test("loading skeleton shown while fetching blob", () => {
    const event = makeEvent();
    // Never resolves during this assertion window
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    fireEvent.click(screen.getByTestId("event-toggle-evt-1"));

    // Skeleton present (no blob content yet)
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("error state shown when blob fetch fails", async () => {
    const event = makeEvent();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal Server Error" }),
    });

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    await expandEvent("evt-1");

    expect(screen.getByTestId("blob-error")).toBeInTheDocument();
    expect(screen.getByText(/Internal Server Error/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// StackTraceViewer — structured frames rendering
// ---------------------------------------------------------------------------

describe("StackTraceViewer — structured frames", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  function makeBlobWithFrames(frames: unknown[]): string {
    return JSON.stringify({
      exceptionType: "RuntimeError",
      message: "oops",
      stackTrace: "RuntimeError: oops\n  raw fallback line",
      frames,
    });
  }

  test("inApp:true frames render as clickable GitHub links with correct href", async () => {
    const event = makeEvent({
      commitSha: "abc1234def5678901234567890abcdef12345678",
      repositoryUrl: "https://github.com/stakwork/hive",
    });
    const frames = [
      { filename: "app/controllers/posts_controller.rb", function: "show", lineno: 22, inApp: true },
      { filename: "/usr/local/bundle/gems/rack-2.2.6/lib/rack.rb", function: "call", lineno: 50, inApp: false },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => makeBlobWithFrames(frames),
      json: async () => ({}),
    });

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    await expandEvent("evt-1");

    // inApp:true frame → link
    const links = screen.getAllByRole("link");
    const appLink = links.find((l) =>
      (l as HTMLAnchorElement).href.includes("posts_controller.rb")
    ) as HTMLAnchorElement | undefined;
    expect(appLink).toBeDefined();
    expect(appLink!.href).toBe(
      "https://github.com/stakwork/hive/blob/abc1234def5678901234567890abcdef12345678/app/controllers/posts_controller.rb#L22"
    );
    expect(appLink!.target).toBe("_blank");
    expect(appLink!.rel).toContain("noopener");
  });

  test("inApp:false frames render as dimmed non-link text", async () => {
    const event = makeEvent({
      commitSha: "abc1234def5678901234567890abcdef12345678",
      repositoryUrl: "https://github.com/stakwork/hive",
    });
    const frames = [
      { filename: "app/controllers/posts_controller.rb", function: "show", lineno: 22, inApp: true },
      { filename: "/usr/local/bundle/gems/rack-2.2.6/lib/rack.rb", function: "call", lineno: 50, inApp: false },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => makeBlobWithFrames(frames),
      json: async () => ({}),
    });

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    await expandEvent("evt-1");

    // inApp:false frame → no link, but text present
    const links = screen.queryAllByRole("link");
    const gemLink = links.find((l) => (l as HTMLAnchorElement).href.includes("rack.rb"));
    expect(gemLink).toBeUndefined();

    // Text still appears (dimmed span)
    expect(screen.getByText(/rack\.rb/, { exact: false })).toBeInTheDocument();
  });

  test("falls back to parseStackFrameLines when frames array is empty", async () => {
    const event = makeEvent({
      commitSha: "abc1234def5678901234567890abcdef12345678",
      repositoryUrl: "https://github.com/stakwork/hive",
    });
    const blobWithEmptyFrames = JSON.stringify({
      exceptionType: "TypeError",
      message: "oops",
      stackTrace: SAMPLE_STACK,
      frames: [],
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => blobWithEmptyFrames,
      json: async () => ({}),
    });

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    await expandEvent("evt-1");

    // The raw stack trace fallback should produce a link for the resolvable frame
    const links = screen.getAllByRole("link");
    const productListLink = links.find((l) =>
      (l as HTMLAnchorElement).href.includes("components/ProductList.tsx")
    );
    expect(productListLink).toBeDefined();
  });

  test("falls back to parseStackFrameLines when frames key absent from blob", async () => {
    const event = makeEvent({
      commitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      repositoryUrl: "https://github.com/stakwork/hive",
    });
    // Blob with no frames key at all
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => makeBlobJson(SAMPLE_STACK),
      json: async () => ({}),
    });

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    await expandEvent("evt-1");

    // Fallback path renders the app frame as a link
    const links = screen.getAllByRole("link");
    const appLink = links.find((l) =>
      (l as HTMLAnchorElement).href.includes("components/ProductList.tsx")
    );
    expect(appLink).toBeDefined();
  });

  test("displays filename:lineno and function name for structured frames", async () => {
    const event = makeEvent({ repositoryUrl: null }); // no links possible
    const frames = [
      { filename: "app/models/user.rb", function: "validate", lineno: 15, inApp: true },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => makeBlobWithFrames(frames),
      json: async () => ({}),
    });

    render(<ErrorIssueDetail detail={makeDetail(event)} />);
    await expandEvent("evt-1");

    expect(screen.getByText(/app\/models\/user\.rb:15 in validate/, { exact: false })).toBeInTheDocument();
  });
});
