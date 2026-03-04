import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactType } from "@prisma/client";
import type { Artifact } from "@/lib/chat";

// --- Mock all heavy dependencies before importing the component ---

const mockNavigateToUrl = vi.fn();
let mockCurrentUrl: string | null = null;

vi.mock("@/hooks/useStaktrak", () => ({
  useStaktrak: (_url: string) => ({
    currentUrl: mockCurrentUrl,
    iframeRef: { current: null },
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
  }),
}));

vi.mock("@/hooks/useStaktrakReplay", () => ({
  usePlaywrightReplay: () => ({
    isPlaywrightReplaying: false,
    playwrightProgress: 0,
    startPlaywrightReplay: vi.fn(),
    stopPlaywrightReplay: vi.fn(),
    replayScreenshots: [],
    replayActions: [],
    previewActions: [],
    previewPlaywrightReplay: vi.fn(),
  }),
}));

vi.mock("@/hooks/useBrowserLoadingStatus", () => ({
  useBrowserLoadingStatus: () => ({ isReady: true }),
}));

vi.mock("@/hooks/useDebugSelection", () => ({
  useDebugSelection: () => ({
    debugMode: false,
    isSubmittingDebug: false,
    setDebugMode: vi.fn(),
    handleDebugSelection: vi.fn(),
  }),
}));

vi.mock("@/components/DebugOverlay", () => ({
  DebugOverlay: () => <div data-testid="debug-overlay" />,
}));

vi.mock("@/components/ActionsList", () => ({
  ActionsList: () => <div data-testid="actions-list" />,
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts/TestManagerModal", () => ({
  TestManagerModal: () => <div data-testid="test-manager-modal" />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/constants", () => ({ SIDEBAR_WIDTH: 240 }));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// Import component AFTER mocks are set up
import { BrowserArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/browser";

// Helper to create a browser artifact
const makeBrowserArtifact = (url: string, id = "artifact-1"): Artifact =>
  ({
    id,
    type: ArtifactType.BROWSER,
    content: { url },
    createdAt: new Date(),
    updatedAt: new Date(),
    chatMessageId: "msg-1",
    icon: null,
  }) as unknown as Artifact;

describe("BrowserArtifactPanel — refresh uses current URL", () => {
  beforeEach(() => {
    mockCurrentUrl = null;
    mockNavigateToUrl.mockClear();
  });

  it("uses content.url as iframe src when no navigation has occurred", () => {
    const artifact = makeBrowserArtifact("https://original.example.com");
    const { container } = render(<BrowserArtifactPanel artifacts={[artifact]} />);

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toBe("https://original.example.com");
  });

  it("uses displayUrl (navigated URL) as iframe src after navigation", () => {
    mockCurrentUrl = "https://navigated.example.com";

    const artifact = makeBrowserArtifact("https://original.example.com");
    const { container } = render(<BrowserArtifactPanel artifacts={[artifact]} />);

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    // Active tab should use the navigated URL, not the original
    expect(iframe!.getAttribute("src")).toBe("https://navigated.example.com");
  });

  it("falls back to content.url when displayUrl is null", () => {
    mockCurrentUrl = null;

    const artifact = makeBrowserArtifact("https://original.example.com");
    const { container } = render(<BrowserArtifactPanel artifacts={[artifact]} />);

    const iframe = container.querySelector("iframe");
    expect(iframe!.getAttribute("src")).toBe("https://original.example.com");
  });
});
