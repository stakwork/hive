/**
 * @vitest-environment jsdom
 *
 * Unit tests for DownloadReportButton.
 *
 * Covers:
 * - idle → loading → idle on success; URL.createObjectURL called with the blob
 * - Non-OK response (403) → error state with Retry; JSON body NOT downloaded
 * - Clicking Retry after an error re-issues the fetch
 * - Unmounting mid-request aborts the fetch without setting state on the
 *   unmounted component (no React act warnings / leaks)
 * - Content-Disposition filename parsing: plain form, RFC 5987, absent, malformed
 *
 * Anchor intercept strategy:
 *   The component creates an <a>, sets href/download, appends it to
 *   document.body, calls .click(), and removes it. We intercept
 *   document.createElement inside each test (not at module scope, so
 *   afterEach restoreAllMocks doesn't break it) so we can attach a no-op
 *   .click() spy and capture the href/download values before removal.
 *   This avoids jsdom's "Not implemented: navigation" error that fires when
 *   a real anchor with a blob: href gets clicked.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DownloadReportButton } from "@/components/run-report/DownloadReportButton";

globalThis.React = React;

// ─── Stable global stubs ─────────────────────────────────────────────────────
// These are set once and never restored, so they survive afterEach cleanup.

const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
const mockRevokeObjectURL = vi.fn();
Object.defineProperty(globalThis.URL, "createObjectURL", {
  value: mockCreateObjectURL,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis.URL, "revokeObjectURL", {
  value: mockRevokeObjectURL,
  writable: true,
  configurable: true,
});

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ─── UI / icon mocks ──────────────────────────────────────────────────────────

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    "data-testid": testId,
    "aria-label": ariaLabel,
    ...rest
  }: React.ComponentProps<"button"> & { "data-testid"?: string }) =>
    React.createElement(
      "button",
      { onClick, disabled, "data-testid": testId, "aria-label": ariaLabel, ...rest },
      children,
    ),
}));

vi.mock("lucide-react", () => ({
  AlertCircle: () => React.createElement("span", { "data-testid": "icon-alert" }),
  Download: () => React.createElement("span", { "data-testid": "icon-download" }),
  Loader2: () => React.createElement("span", { "data-testid": "icon-loader" }),
  RefreshCw: () => React.createElement("span", { "data-testid": "icon-refresh" }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EXPORT_URL = "/api/workspaces/test-ws/legal/benchmarks/runs/run-1/report/export";

type AnchorRecord = { href: string; download: string; clickCalled: boolean };

/**
 * Intercepts document.createElement so every <a> element created during the
 * test gets a no-op click() (preventing jsdom navigation) and is recorded in
 * `records`.  Returns a teardown function that restores the original.
 */
function interceptAnchors(records: AnchorRecord[]): () => void {
  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    (tag: string, ...rest: Parameters<typeof document.createElement> extends [string, ...infer R] ? R : never) => {
      const el = origCreateElement(tag, ...rest);
      if (tag.toLowerCase() === "a") {
        const record: AnchorRecord = { href: "", download: "", clickCalled: false };
        records.push(record);
        // Proxy href and download so we capture the final values at click time
        const nativeClick = el.click.bind(el);
        el.click = () => {
          record.href = (el as HTMLAnchorElement).href;
          record.download = (el as HTMLAnchorElement).download;
          record.clickCalled = true;
          // Do NOT call nativeClick: that would trigger jsdom navigation for blob: URLs
        };
      }
      return el;
    },
  );
  return () => vi.restoreAllMocks();
}

/**
 * Build a minimal mock Response.
 */
function makeResponse({
  ok = true,
  status = 200,
  body = new Blob(["ZIP"], { type: "application/zip" }),
  contentDisposition = null as string | null,
  jsonBody = { error: "Forbidden" } as object,
}: {
  ok?: boolean;
  status?: number;
  body?: Blob;
  contentDisposition?: string | null;
  jsonBody?: object;
} = {}): Response {
  const headers = new Headers();
  if (contentDisposition) headers.set("Content-Disposition", contentDisposition);
  return {
    ok,
    status,
    headers,
    blob: vi.fn(async () => body),
    json: vi.fn(async () => jsonBody),
  } as unknown as Response;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockFetch.mockReset();
  mockCreateObjectURL.mockReset();
  mockCreateObjectURL.mockReturnValue("blob:mock-url");
  mockRevokeObjectURL.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DownloadReportButton", () => {
  // ── Initial render ──────────────────────────────────────────────────────────

  it("renders idle state with default label and download icon", () => {
    render(<DownloadReportButton exportUrl={EXPORT_URL} />);
    const btn = screen.getByTestId("download-report-button");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("Download ZIP");
    expect(btn).not.toBeDisabled();
    expect(screen.getByTestId("icon-download")).toBeInTheDocument();
    expect(screen.queryByTestId("icon-loader")).not.toBeInTheDocument();
  });

  it("renders a custom label when supplied", () => {
    render(<DownloadReportButton exportUrl={EXPORT_URL} label="Export Report" />);
    expect(screen.getByTestId("download-report-button")).toHaveTextContent("Export Report");
  });

  // ── Success path ────────────────────────────────────────────────────────────

  it("idle → loading → idle on success; createObjectURL called; anchor clicked with blob URL", async () => {
    const anchors: AnchorRecord[] = [];
    const restore = interceptAnchors(anchors);

    const user = userEvent.setup();
    const zipBlob = new Blob(["ZIP"], { type: "application/zip" });

    // Delay the response so we can assert the loading state
    let resolveFetch!: (r: Response) => void;
    mockFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );

    render(<DownloadReportButton exportUrl={EXPORT_URL} />);
    await user.click(screen.getByTestId("download-report-button"));

    // Loading state: button disabled, "Building…", spinner
    await waitFor(() => {
      expect(screen.getByTestId("download-report-button")).toBeDisabled();
    });
    expect(screen.getByTestId("download-report-button")).toHaveTextContent("Building");
    expect(screen.getByTestId("icon-loader")).toBeInTheDocument();

    // Resolve the response
    await act(async () => {
      resolveFetch(makeResponse({ body: zipBlob }));
    });

    // Back to idle after success
    await waitFor(() => {
      expect(screen.getByTestId("download-report-button")).not.toBeDisabled();
      expect(screen.getByTestId("download-report-button")).toHaveTextContent("Download ZIP");
    });
    expect(screen.queryByTestId("download-report-error")).not.toBeInTheDocument();

    // Blob URL was created from the response blob
    expect(mockCreateObjectURL).toHaveBeenCalledWith(zipBlob);

    // Anchor was created, had href set to blob URL, and was clicked
    expect(anchors).toHaveLength(1);
    expect(anchors[0].href).toBe("blob:mock-url");
    expect(anchors[0].clickCalled).toBe(true);

    // Object URL was revoked
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    // fetch was called with the right URL and an AbortSignal
    expect(mockFetch).toHaveBeenCalledWith(
      EXPORT_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    restore();
  });

  it("reads filename from Content-Disposition plain form (filename=\"...\")", async () => {
    const anchors: AnchorRecord[] = [];
    const restore = interceptAnchors(anchors);
    const user = userEvent.setup();

    mockFetch.mockResolvedValueOnce(
      makeResponse({ contentDisposition: 'attachment; filename="my-report.zip"' }),
    );

    render(<DownloadReportButton exportUrl={EXPORT_URL} />);
    await user.click(screen.getByTestId("download-report-button"));
    await waitFor(() => expect(screen.getByTestId("download-report-button")).not.toBeDisabled());

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("my-report.zip");
    expect(anchors[0].clickCalled).toBe(true);
    restore();
  });

  it("reads filename from RFC 5987 filename*=UTF-8'' form", async () => {
    const anchors: AnchorRecord[] = [];
    const restore = interceptAnchors(anchors);
    const user = userEvent.setup();

    mockFetch.mockResolvedValueOnce(
      makeResponse({
        contentDisposition: "attachment; filename*=UTF-8''my%20report%202024.zip",
      }),
    );

    render(<DownloadReportButton exportUrl={EXPORT_URL} />);
    await user.click(screen.getByTestId("download-report-button"));
    await waitFor(() => expect(screen.getByTestId("download-report-button")).not.toBeDisabled());

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("my report 2024.zip");
    restore();
  });

  it("falls back to 'report-export.zip' when Content-Disposition header is absent", async () => {
    const anchors: AnchorRecord[] = [];
    const restore = interceptAnchors(anchors);
    const user = userEvent.setup();

    mockFetch.mockResolvedValueOnce(makeResponse({ contentDisposition: null }));

    render(<DownloadReportButton exportUrl={EXPORT_URL} />);
    await user.click(screen.getByTestId("download-report-button"));
    await waitFor(() => expect(screen.getByTestId("download-report-button")).not.toBeDisabled());

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("report-export.zip");
    restore();
  });

  it("falls back to 'report-export.zip' when RFC 5987 percent-encoding is malformed", async () => {
    const anchors: AnchorRecord[] = [];
    const restore = interceptAnchors(anchors);
    const user = userEvent.setup();

    mockFetch.mockResolvedValueOnce(
      makeResponse({
        // %ZZ is not valid percent-encoding — decodeURIComponent will throw
        contentDisposition: "attachment; filename*=UTF-8''report%ZZ.zip",
      }),
    );

    render(<DownloadReportButton exportUrl={EXPORT_URL} />);
    await user.click(screen.getByTestId("download-report-button"));
    await waitFor(() => expect(screen.getByTestId("download-report-button")).not.toBeDisabled());

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("report-export.zip");
    expect(mockRevokeObjectURL).toHaveBeenCalled();
    restore();
  });

  // ── Error path ──────────────────────────────────────────────────────────────

  it("non-OK response → error state with message and Retry; blob NOT downloaded", async () => {
    const anchors: AnchorRecord[] = [];
    const restore = interceptAnchors(anchors);
    const user = userEvent.setup();

    mockFetch.mockResolvedValueOnce(
      makeResponse({ ok: false, status: 403, jsonBody: { error: "Forbidden" } }),
    );

    render(<DownloadReportButton exportUrl={EXPORT_URL} />);
    await user.click(screen.getByTestId("download-report-button"));

    await waitFor(() => {
      expect(screen.getByTestId("download-report-error")).toBeInTheDocument();
    });

    expect(screen.getByTestId("download-report-retry")).toBeInTheDocument();
    expect(screen.getByText(/Forbidden/i)).toBeInTheDocument();

    // The JSON body must NOT have been downloaded as a ZIP
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    expect(anchors).toHaveLength(0);
    restore();
  });

  it("non-OK response with non-JSON body falls back to 'Server returned <status>'", async () => {
    const restore = interceptAnchors([]);
    const user = userEvent.setup();

    const resp = makeResponse({ ok: false, status: 500 });
    (resp.json as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new SyntaxError("Unexpected token"),
    );
    mockFetch.mockResolvedValueOnce(resp);

    render(<DownloadReportButton exportUrl={EXPORT_URL} />);
    await user.click(screen.getByTestId("download-report-button"));

    await waitFor(() => {
      expect(screen.getByTestId("download-report-error")).toBeInTheDocument();
    });

    expect(screen.getByText(/Server returned 500/i)).toBeInTheDocument();
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    restore();
  });

  // ── Retry ───────────────────────────────────────────────────────────────────

  it("clicking Retry re-issues the fetch and succeeds on the second attempt", async () => {
    const anchors: AnchorRecord[] = [];
    const restore = interceptAnchors(anchors);
    const user = userEvent.setup();

    mockFetch
      .mockResolvedValueOnce(
        makeResponse({ ok: false, status: 403, jsonBody: { error: "Forbidden" } }),
      )
      .mockResolvedValueOnce(makeResponse());

    render(<DownloadReportButton exportUrl={EXPORT_URL} />);

    // First attempt → error
    await user.click(screen.getByTestId("download-report-button"));
    await waitFor(() => {
      expect(screen.getByTestId("download-report-retry")).toBeInTheDocument();
    });

    // Retry → success
    await user.click(screen.getByTestId("download-report-retry"));
    await waitFor(() => {
      expect(screen.getByTestId("download-report-button")).toBeInTheDocument();
      expect(screen.queryByTestId("download-report-error")).not.toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].clickCalled).toBe(true);
    restore();
  });

  // ── Unmount / AbortController ────────────────────────────────────────────────

  it("unmounting mid-request aborts the fetch and does not set state afterward", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockFetch.mockImplementationOnce((_url: string, opts: RequestInit) => {
      capturedSignal = opts.signal as AbortSignal;
      return new Promise<Response>(() => { /* intentionally never resolves */ });
    });

    const { unmount } = render(<DownloadReportButton exportUrl={EXPORT_URL} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("download-report-button"));

    // Button enters loading state
    await waitFor(() => {
      expect(screen.getByTestId("download-report-button")).toBeDisabled();
    });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    // Unmount → useEffect cleanup must abort the in-flight controller
    act(() => { unmount(); });

    expect(capturedSignal!.aborted).toBe(true);

    // No act() / "state update on unmounted component" warnings should appear.
    // If the component tried to setState after unmount, React 18 would log.
    // The test passing cleanly is the assertion.
  });

  // ── Network error ────────────────────────────────────────────────────────────

  it("network error (fetch rejects) shows the error message in the error state", async () => {
    const restore = interceptAnchors([]);
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<DownloadReportButton exportUrl={EXPORT_URL} />);
    await user.click(screen.getByTestId("download-report-button"));

    await waitFor(() => {
      expect(screen.getByTestId("download-report-error")).toBeInTheDocument();
    });

    expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument();
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    restore();
  });

  // ── Object URL cleanup ───────────────────────────────────────────────────────

  it("always revokes the object URL in the finally block after a successful download", async () => {
    const restore = interceptAnchors([]);
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(makeResponse());

    render(<DownloadReportButton exportUrl={EXPORT_URL} />);
    await user.click(screen.getByTestId("download-report-button"));

    await waitFor(() => {
      expect(screen.getByTestId("download-report-button")).not.toBeDisabled();
    });

    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(mockRevokeObjectURL).toHaveBeenCalledTimes(1);
    restore();
  });
});
