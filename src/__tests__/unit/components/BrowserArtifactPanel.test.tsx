import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Make React globally available for components that rely on automatic JSX transform
if (typeof (global as any).React === "undefined") {
  (global as any).React = React;
}
import { BrowserArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/browser";
import type { Artifact } from "@/lib/chat";

// ── Mock heavy hooks ────────────────────────────────────────────────────────

let mockCurrentUrl: string | null = null;
const mockNavigateToUrl = vi.fn();
const mockIframeRef = { current: null };

vi.mock("@/hooks/useStaktrak", () => ({
  useStaktrak: vi.fn(() => ({
    currentUrl: mockCurrentUrl,
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
    navigateToUrl: mockNavigateToUrl,
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

vi.mock("@/components/DebugOverlay", () => ({
  DebugOverlay: () => null,
}));

vi.mock("@/components/ActionsList", () => ({
  ActionsList: () => null,
}));

vi.mock("./TestManagerModal", () => ({
  TestManagerModal: () => null,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const ORIGINAL_URL = "https://original.example.com";
const NAVIGATED_URL = "https://navigated.example.com";

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("BrowserArtifactPanel – iframe src on refresh", () => {
  beforeEach(() => {
    mockCurrentUrl = null;
    mockNavigateToUrl.mockReset();
  });

  test("uses original content.url when no navigation has occurred", () => {
    // currentUrl is null → displayUrl falls back to content.url
    mockCurrentUrl = null;

    render(
      <BrowserArtifactPanel
        artifacts={[makeArtifact(ORIGINAL_URL)]}
        podId="pod-1"
      />
    );

    expect(getIframeSrc()).toBe(ORIGINAL_URL);
  });

  test("uses displayUrl (navigated URL) after navigation when active", () => {
    // Simulate that useStaktrak reported a new currentUrl after navigation
    mockCurrentUrl = NAVIGATED_URL;

    render(
      <BrowserArtifactPanel
        artifacts={[makeArtifact(ORIGINAL_URL)]}
        podId="pod-1"
      />
    );

    // Active tab should show the navigated URL
    expect(getIframeSrc()).toBe(NAVIGATED_URL);
  });

  test("refresh reloads the navigated URL (not original) when user has navigated", () => {
    mockCurrentUrl = NAVIGATED_URL;

    render(
      <BrowserArtifactPanel
        artifacts={[makeArtifact(ORIGINAL_URL)]}
        podId="pod-1"
      />
    );

    // Verify navigated URL is used before refresh
    expect(getIframeSrc()).toBe(NAVIGATED_URL);

    // Click refresh — the iframe key changes but src must still be displayUrl
    const refreshBtn = screen.getByRole("button", { name: /refresh/i });
    fireEvent.click(refreshBtn);

    // After refresh, iframe re-mounts with same displayUrl
    expect(getIframeSrc()).toBe(NAVIGATED_URL);
  });

  test("refresh reloads original URL when no navigation has occurred", () => {
    mockCurrentUrl = null;

    render(
      <BrowserArtifactPanel
        artifacts={[makeArtifact(ORIGINAL_URL)]}
        podId="pod-1"
      />
    );

    const refreshBtn = screen.getByRole("button", { name: /refresh/i });
    fireEvent.click(refreshBtn);

    expect(getIframeSrc()).toBe(ORIGINAL_URL);
  });
});
