/**
 * Unit tests for HtmlArtifactFrame — the single renderer for stored HTML.
 *
 * Asserts the security posture, not the styling:
 *   - sandbox grants only allow-scripts (never allow-same-origin / …)
 *   - the blob is the page with the CSP meta tag injected, typed text/html
 *   - `dangerouslySetInnerHTML` is never used (props + source text)
 *   - `src` is only ever a blob: URL (never the proxy or an S3 URL)
 *   - the blob URL is revoked on unmount
 *   - non-2xx and thrown fetch errors render the error state, no iframe
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

import {
  HtmlArtifactFrame,
  HTML_FRAME_SANDBOX,
} from "@/components/html-artifact/HtmlArtifactFrame";
import { injectHtmlArtifactCsp } from "@/lib/utils/html-artifact-csp";

// JSX compiles to React.createElement (tsconfig jsx: preserve) — the
// component under test relies on a global React, as other component
// tests in this repo do.
globalThis.React = React;

const BLOB_URL = "blob:http://localhost/abc-123";

const mockFetch = vi.fn();
const createObjectURL = vi.fn<(blob: Blob) => string>(() => BLOB_URL);
const revokeObjectURL = vi.fn();

const ORG_SOURCE = { githubLogin: "acme-org", slug: "my-page" };
const TASK_SOURCE = { taskId: "task-1", artifactId: "artifact-1" };

const PAGE_HTML = "<!DOCTYPE html><html><body>hi</body></html>";

function htmlResponse(html = PAGE_HTML) {
  return {
    ok: true,
    status: 200,
    text: async () => html,
  };
}

async function findIframe(): Promise<HTMLIFrameElement> {
  return await waitFor(() => {
    const frame = document.querySelector("iframe");
    expect(frame).not.toBeNull();
    return frame as HTMLIFrameElement;
  });
}

describe("HtmlArtifactFrame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    createObjectURL.mockReturnValue(BLOB_URL);
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    mockFetch.mockResolvedValue(htmlResponse());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("sandbox grants allow-scripts and nothing else", async () => {
    render(<HtmlArtifactFrame source={ORG_SOURCE} />);
    const iframe = await findIframe();
    const sandbox = iframe.getAttribute("sandbox") ?? "";

    expect(iframe.hasAttribute("sandbox")).toBe(true);
    expect(sandbox.trim().split(/\s+/)).toEqual(["allow-scripts"]);
    expect(HTML_FRAME_SANDBOX).toBe("allow-scripts");
  });

  test("sandbox never grants same-origin, navigation, popups, forms, or modals", async () => {
    render(<HtmlArtifactFrame source={ORG_SOURCE} />);
    const iframe = await findIframe();
    const sandbox = iframe.getAttribute("sandbox") ?? "";

    // `allow-same-origin` in particular must never be combined with
    // `allow-scripts`: the blob is minted on Hive's origin, so the pair
    // would let the page remove its own sandbox.
    for (const token of [
      "allow-same-origin",
      "allow-top-navigation",
      "allow-top-navigation-by-user-activation",
      "allow-popups",
      "allow-popups-to-escape-sandbox",
      "allow-forms",
      "allow-modals",
      "allow-downloads",
    ]) {
      expect(sandbox).not.toContain(token);
    }
  });

  test("blob is the page with the CSP meta injected, typed as HTML", async () => {
    render(<HtmlArtifactFrame source={ORG_SOURCE} />);
    await findIframe();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/html; charset=utf-8");
    // Same bytes the CSP helper produces for this page — i.e. the meta
    // tag was prepended rather than the raw body being framed as-is.
    const expected = new Blob([injectHtmlArtifactCsp(PAGE_HTML)]);
    expect(blob.size).toBe(expected.size);
    expect(blob.size).toBeGreaterThan(new Blob([PAGE_HTML]).size);
  });

  test("iframe src is a blob: URL, never the proxy or an S3 URL", async () => {
    render(<HtmlArtifactFrame source={ORG_SOURCE} />);
    const iframe = await findIframe();
    const src = iframe.getAttribute("src") ?? "";

    expect(src).toBe(BLOB_URL);
    expect(src.startsWith("blob:")).toBe(true);
    expect(src).not.toContain("/api/orgs/");
    expect(src).not.toContain("s3");
    expect(iframe.hasAttribute("srcdoc")).toBe(false);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  test("fetches the org proxy with credentials and no store", async () => {
    render(<HtmlArtifactFrame source={ORG_SOURCE} />);
    await findIframe();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/orgs/acme-org/html-pages/my-page",
      { credentials: "include", cache: "no-store" },
    );
  });

  test("fetches the task proxy for a task-scoped source", async () => {
    render(<HtmlArtifactFrame source={TASK_SOURCE} />);
    await findIframe();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/tasks/task-1/artifacts/artifact-1/html",
      { credentials: "include", cache: "no-store" },
    );
  });

  test("does not use dangerouslySetInnerHTML in the rendered output", async () => {
    const createElement = vi.spyOn(React, "createElement");
    const { container } = render(<HtmlArtifactFrame source={ORG_SOURCE} />);
    await findIframe();

    for (const call of createElement.mock.calls) {
      const props = call[1] as Record<string, unknown> | null;
      if (props) expect(props).not.toHaveProperty("dangerouslySetInnerHTML");
    }
    // The untrusted body never lands in Hive's own DOM.
    expect(container.innerHTML).not.toContain("<!DOCTYPE html>");
    createElement.mockRestore();
  });

  test("component source never mentions dangerouslySetInnerHTML or srcDoc", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/components/html-artifact/HtmlArtifactFrame.tsx",
      ),
      "utf8",
    );
    // Strip the doc comments, which mention the APIs to explain their absence.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("dangerouslySetInnerHTML");
    expect(code).not.toContain("srcDoc");
    expect(code).not.toContain("innerHTML");
  });

  test("revokes the blob URL on unmount", async () => {
    const { unmount } = render(<HtmlArtifactFrame source={ORG_SOURCE} />);
    await findIframe();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
  });

  test("renders the error state and no iframe on a 404 response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "" });
    render(<HtmlArtifactFrame source={ORG_SOURCE} />);

    expect(
      await screen.findByText("This page is no longer available."),
    ).toBeDefined();
    expect(document.querySelector("iframe")).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("renders an access error on a 403 response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: async () => "" });
    render(<HtmlArtifactFrame source={ORG_SOURCE} />);

    expect(
      await screen.findByText("You don't have access to this page."),
    ).toBeDefined();
    expect(document.querySelector("iframe")).toBeNull();
  });

  test("renders the error state and no iframe when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    render(<HtmlArtifactFrame source={ORG_SOURCE} />);

    expect(await screen.findByText("network down")).toBeDefined();
    expect(document.querySelector("iframe")).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("re-fetches when updatedAt changes", async () => {
    const { rerender } = render(
      <HtmlArtifactFrame source={ORG_SOURCE} updatedAt="2024-01-01T00:00:00.000Z" />,
    );
    await findIframe();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    rerender(
      <HtmlArtifactFrame source={ORG_SOURCE} updatedAt="2024-06-01T00:00:00.000Z" />,
    );
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  test("falls back to a generic message for a non-Error rejection", async () => {
    mockFetch.mockRejectedValue("boom");
    render(<HtmlArtifactFrame source={ORG_SOURCE} />);

    expect(await screen.findByText("Failed to load this page.")).toBeDefined();
    expect(document.querySelector("iframe")).toBeNull();
  });
});
