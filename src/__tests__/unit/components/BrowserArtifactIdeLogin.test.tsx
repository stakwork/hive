/**
 * @vitest-environment jsdom
 *
 * Unit tests for BrowserArtifactPanel IDE auto-login behaviour.
 * Covers the ideAuthUrl state and the useEffect that calls /api/tasks/[taskId]/ide-token.
 */
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

if (typeof (global as any).React === "undefined") {
  (global as any).React = React;
}

import { BrowserArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/browser";
import type { Artifact } from "@/lib/chat";

// ── Mock heavy hooks (same as BrowserArtifactPanel.test.tsx) ─────────────────

const mockIframeRef = { current: null };

vi.mock("@/hooks/useStaktrak", () => ({
  useStaktrak: vi.fn(() => ({
    currentUrl: null,
    iframeRef: mockIframeRef,
    isSetup: false,
    isRecording: false,
    isAssertionMode: false,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    enableAssertionMode: vi.fn(),
    disableAssertionMode: vi.fn(),
    generatedPlaywrightTest: null,
    generationError: null,
    capturedActions: [],
    showActions: false,
    removeAction: vi.fn(),
    clearAllActions: vi.fn(),
    toggleActionsView: vi.fn(),
    isRecorderReady: false,
    navigateToUrl: vi.fn(),
  })),
}));

vi.mock("@/hooks/useStaktrakReplay", () => ({
  usePlaywrightReplay: vi.fn(() => ({
    isPlaywrightReplaying: false,
    playwrightProgress: { current: 0, total: 0 },
    replayScreenshots: [],
    replayActions: [],
    previewActions: [],
    previewPlaywrightReplay: vi.fn(),
    startPlaywrightReplay: vi.fn(),
    stopPlaywrightReplay: vi.fn(),
  })),
}));

vi.mock("@/hooks/useBrowserLoadingStatus", () => ({
  useBrowserLoadingStatus: vi.fn(() => ({ isReady: true })),
}));

vi.mock("@/hooks/useDebugSelection", () => ({
  useDebugSelection: vi.fn(() => ({
    isSubmittingDebug: false,
    handleDebugSelection: vi.fn(),
  })),
}));

vi.mock("@/components/DebugOverlay", () => ({ DebugOverlay: () => null }));
vi.mock("@/components/ActionsList", () => ({ ActionsList: () => null }));
vi.mock("./TestManagerModal", () => ({ TestManagerModal: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ── Helpers ───────────────────────────────────────────────────────────────────

const IDE_URL = "https://pod-123.workspaces.sphinx.chat";
const RAW_IDE_URL = "https://pod-123-8444.workspaces.sphinx.chat";
const TOKEN = "abc123deadbeef";
const EXPIRES = 9999999999;
const TASK_ID = "task-abc";

function makeArtifact(url: string): Artifact {
  return {
    id: "artifact-1",
    type: "BROWSER",
    content: { url },
  } as unknown as Artifact;
}

function getIframeSrc(): string | null {
  const iframe = screen.getByTitle("Live Preview 1") as HTMLIFrameElement;
  return iframe.getAttribute("src");
}

function mockFetchSuccess(token: string | null = TOKEN): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ token, expires: EXPIRES, ideUrl: IDE_URL }),
  } as unknown as Response);
}

function mockFetchFailure(): void {
  global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
}

function mockFetchNotOk(): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: "Unauthorized" }),
  } as unknown as Response);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BrowserArtifactPanel – IDE auto-login (ideAuthUrl)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("iframe initially shows about:blank while waiting for ide-token fetch", () => {
    // Fetch never resolves within this synchronous check
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(
      <BrowserArtifactPanel
        artifacts={[makeArtifact(RAW_IDE_URL)]}
        ide={true}
        taskId={TASK_ID}
        podId="pod-123"
      />,
    );

    // ideAuthUrl is still null → about:blank
    expect(getIframeSrc()).toBe("about:blank");
  });

  test("sets iframe src to /ide-auth URL after successful token fetch", async () => {
    mockFetchSuccess(TOKEN);

    render(
      <BrowserArtifactPanel
        artifacts={[makeArtifact(RAW_IDE_URL)]}
        ide={true}
        taskId={TASK_ID}
        podId="pod-123"
      />,
    );

    await waitFor(() => {
      expect(getIframeSrc()).toBe(`${IDE_URL}/ide-auth?token=${TOKEN}&expires=${EXPIRES}`);
    });

    // Verify the correct endpoint was called
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/tasks/${TASK_ID}/ide-token`,
      { method: "POST" },
    );
  });

  test("falls back to content.url when ide-token returns { token: null }", async () => {
    mockFetchSuccess(null);

    render(
      <BrowserArtifactPanel
        artifacts={[makeArtifact(RAW_IDE_URL)]}
        ide={true}
        taskId={TASK_ID}
        podId="pod-123"
      />,
    );

    await waitFor(() => {
      expect(getIframeSrc()).toBe(RAW_IDE_URL);
    });
  });

  test("falls back to content.url when fetch throws", async () => {
    mockFetchFailure();

    render(
      <BrowserArtifactPanel
        artifacts={[makeArtifact(RAW_IDE_URL)]}
        ide={true}
        taskId={TASK_ID}
        podId="pod-123"
      />,
    );

    await waitFor(() => {
      expect(getIframeSrc()).toBe(RAW_IDE_URL);
    });
  });

  test("falls back to content.url when fetch response is not ok", async () => {
    mockFetchNotOk();

    render(
      <BrowserArtifactPanel
        artifacts={[makeArtifact(RAW_IDE_URL)]}
        ide={true}
        taskId={TASK_ID}
        podId="pod-123"
      />,
    );

    await waitFor(() => {
      expect(getIframeSrc()).toBe(RAW_IDE_URL);
    });
  });

  test("does NOT call ide-token when ide prop is false (normal browser mode)", () => {
    mockFetchSuccess(TOKEN);

    render(
      <BrowserArtifactPanel
        artifacts={[makeArtifact(RAW_IDE_URL)]}
        ide={false}
        taskId={TASK_ID}
        podId="pod-123"
      />,
    );

    expect(global.fetch).not.toHaveBeenCalled();
    // In non-IDE mode, iframe uses content.url directly
    expect(getIframeSrc()).toBe(RAW_IDE_URL);
  });

  test("ide-token fetch is called only once even if component re-renders", async () => {
    mockFetchSuccess(TOKEN);

    const { rerender } = render(
      <BrowserArtifactPanel
        artifacts={[makeArtifact(RAW_IDE_URL)]}
        ide={true}
        taskId={TASK_ID}
        podId="pod-123"
      />,
    );

    await waitFor(() => {
      expect(getIframeSrc()).toContain("/ide-auth?token=");
    });

    // Re-render with same props — ideAuthUrl !== null so effect is skipped
    rerender(
      <BrowserArtifactPanel
        artifacts={[makeArtifact(RAW_IDE_URL)]}
        ide={true}
        taskId={TASK_ID}
        podId="pod-123"
      />,
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
