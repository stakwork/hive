/**
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/browser";
import { Artifact, ArtifactType, BrowserContent } from "@/lib/chat";

// Mock the hooks
vi.mock("@/hooks/useStaktrak", () => ({
  useStaktrak: vi.fn(),
}));

vi.mock("@/hooks/useStaktrakReplay", () => ({
  usePlaywrightReplay: vi.fn(),
}));

vi.mock("@/hooks/useDebugSelection", () => ({
  useDebugSelection: vi.fn(),
}));

// Mock UI components
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, className, variant, size, ...props }: any) => (
    <button 
      onClick={onClick} 
      className={className}
      data-variant={variant}
      data-size={size}
      {...props}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/DebugOverlay", () => ({
  DebugOverlay: ({ isActive, onDebugSelection, isSubmitting }: any) => (
    <div 
      data-testid="debug-overlay" 
      data-active={isActive}
      data-submitting={isSubmitting}
      onClick={() => onDebugSelection(100, 200, 50, 75)}
    >
      Debug Overlay
    </div>
  ),
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts/TestManagerModal", () => ({
  TestManagerModal: ({ isOpen, onClose, generatedCode }: any) => (
    <div 
      data-testid="test-manager-modal" 
      data-open={isOpen}
      data-generated-code={!!generatedCode}
    >
      <button onClick={onClose}>Close Modal</button>
    </div>
  ),
}));

// Mock Lucide icons
vi.mock("lucide-react", () => ({
  Monitor: () => <div data-testid="monitor-icon" />,
  RefreshCw: () => <div data-testid="refresh-icon" />,
  ExternalLink: () => <div data-testid="external-link-icon" />,
  Circle: () => <div data-testid="circle-icon" />,
  Square: () => <div data-testid="square-icon" />,
  Target: () => <div data-testid="target-icon" />,
  FlaskConical: () => <div data-testid="flask-icon" />,
  Bug: () => <div data-testid="bug-icon" />,
  Play: () => <div data-testid="play-icon" />,
  Pause: () => <div data-testid="pause-icon" />,
}));

const { useStaktrak } = await import("@/hooks/useStaktrak");
const { usePlaywrightReplay } = await import("@/hooks/useStaktrakReplay");
const { useDebugSelection } = await import("@/hooks/useDebugSelection");

const mockedUseStaktrak = vi.mocked(useStaktrak);
const mockedUsePlaywrightReplay = vi.mocked(usePlaywrightReplay);
const mockedUseDebugSelection = vi.mocked(useDebugSelection);

describe("BrowserArtifactPanel", () => {
  const mockArtifacts: Artifact[] = [
    {
      id: "artifact-1",
      messageId: "msg-1",
      type: ArtifactType.BROWSER,
      content: {
        url: "https://example.com",
      } as BrowserContent,
      icon: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
    },
    {
      id: "artifact-2", 
      messageId: "msg-2",
      type: ArtifactType.BROWSER,
      content: {
        url: "https://another.com",
      } as BrowserContent,
      icon: null,
      createdAt: new Date("2024-01-02"),
      updatedAt: new Date("2024-01-02"),
    },
  ];

  const mockStaktrakHook = {
    currentUrl: "https://example.com",
    iframeRef: { current: null },
    isSetup: true,
    isRecording: false,
    isAssertionMode: false,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    enableAssertionMode: vi.fn(),
    disableAssertionMode: vi.fn(),
    generatedPlaywrightTest: "",
    setGeneratedPlaywrightTest: vi.fn(),
  };

  const mockPlaywrightReplayHook = {
    isPlaywrightReplaying: false,
    startPlaywrightReplay: vi.fn(),
    stopPlaywrightReplay: vi.fn(),
  };

  const mockDebugSelectionHook = {
    debugMode: false,
    isSubmittingDebug: false,
    setDebugMode: vi.fn(),
    handleDebugElement: vi.fn(),
    handleDebugSelection: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseStaktrak.mockReturnValue(mockStaktrakHook);
    mockedUsePlaywrightReplay.mockReturnValue(mockPlaywrightReplayHook);
    mockedUseDebugSelection.mockReturnValue(mockDebugSelectionHook);
  });

  describe("Tab Switching Functionality", () => {
    test("should render single artifact without tab navigation", () => {
      const singleArtifact = [mockArtifacts[0]];
      render(<BrowserArtifactPanel artifacts={singleArtifact} />);

      // Should not render tab navigation for single artifact
      expect(screen.queryByText("Preview 1")).not.toBeInTheDocument();
      expect(screen.queryByText("Preview 2")).not.toBeInTheDocument();
      
      // Should render iframe with artifact URL
      const iframe = screen.getByTitle("Live Preview 1");
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute("src", "https://example.com");
    });

    test("should render tab navigation for multiple artifacts", () => {
      render(<BrowserArtifactPanel artifacts={mockArtifacts} />);

      // Should render tab navigation
      expect(screen.getByText("Preview 1")).toBeInTheDocument();
      expect(screen.getByText("Preview 2")).toBeInTheDocument();

      // First tab should be active by default
      const firstTab = screen.getByText("Preview 1");
      expect(firstTab).toHaveClass("border-primary");
    });

    test("should switch tabs when tab button is clicked", () => {
      render(<BrowserArtifactPanel artifacts={mockArtifacts} />);

      const firstTab = screen.getByText("Preview 1");
      const secondTab = screen.getByText("Preview 2");

      // Initially first tab is active
      expect(firstTab).toHaveClass("border-primary");
      expect(secondTab).toHaveClass("border-transparent");

      // Click second tab
      fireEvent.click(secondTab);

      // Second tab should now be active
      expect(secondTab).toHaveClass("border-primary");
      expect(firstTab).toHaveClass("border-transparent");
    });

    test("should display correct iframe for active tab", () => {
      render(<BrowserArtifactPanel artifacts={mockArtifacts} />);

      // Initially should show first artifact
      let iframe = screen.getByTitle("Live Preview 1");
      expect(iframe).toHaveAttribute("src", "https://example.com");

      // Switch to second tab
      const secondTab = screen.getByText("Preview 2");
      fireEvent.click(secondTab);

      // Should now show second artifact
      iframe = screen.getByTitle("Live Preview 2");
      expect(iframe).toHaveAttribute("src", "https://another.com");
    });

    test("should disable debug mode when switching tabs", () => {
      const debugModeHook = {
        ...mockDebugSelectionHook,
        debugMode: true,
      };
      mockedUseDebugSelection.mockReturnValue(debugModeHook);

      render(<BrowserArtifactPanel artifacts={mockArtifacts} />);

      const secondTab = screen.getByText("Preview 2");
      fireEvent.click(secondTab);

      // setDebugMode should be called with false when switching tabs
      expect(debugModeHook.setDebugMode).toHaveBeenCalledWith(false);
    });

    test("should use currentUrl from staktrak hook when available", () => {
      const staktrakWithUrl = {
        ...mockStaktrakHook,
        currentUrl: "https://navigated-url.com",
      };
      mockedUseStaktrak.mockReturnValue(staktrakWithUrl);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      // Should display the current URL from staktrak instead of original
      expect(screen.getByText("https://navigated-url.com")).toBeInTheDocument();
    });
  });

  describe("Debug Mode Functionality", () => {
    test("should render debug button", () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      const debugButton = screen.getByTitle("Debug Element");
      expect(debugButton).toBeInTheDocument();
    });

    test("should call handleDebugElement when debug button is clicked", () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      const debugButton = screen.getByTitle("Debug Element");
      fireEvent.click(debugButton);

      expect(mockDebugSelectionHook.handleDebugElement).toHaveBeenCalledTimes(1);
    });

    test("should show debug overlay when debug mode is active", () => {
      const activeDebugHook = {
        ...mockDebugSelectionHook,
        debugMode: true,
      };
      mockedUseDebugSelection.mockReturnValue(activeDebugHook);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      const debugOverlay = screen.getByTestId("debug-overlay");
      expect(debugOverlay).toBeInTheDocument();
      expect(debugOverlay).toHaveAttribute("data-active", "true");
    });

    test("should not show debug overlay when debug mode is inactive", () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      const debugOverlay = screen.getByTestId("debug-overlay");
      expect(debugOverlay).toHaveAttribute("data-active", "false");
    });

    test("should show submitting state in debug overlay", () => {
      const submittingDebugHook = {
        ...mockDebugSelectionHook,
        debugMode: true,
        isSubmittingDebug: true,
      };
      mockedUseDebugSelection.mockReturnValue(submittingDebugHook);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      const debugOverlay = screen.getByTestId("debug-overlay");
      expect(debugOverlay).toHaveAttribute("data-submitting", "true");
    });

    test("should call handleDebugSelection when debug overlay is used", () => {
      const activeDebugHook = {
        ...mockDebugSelectionHook,
        debugMode: true,
      };
      mockedUseDebugSelection.mockReturnValue(activeDebugHook);

      render(<BrowserArtifactPanel artifacts={mockArtifacts} />);

      const debugOverlay = screen.getByTestId("debug-overlay");
      fireEvent.click(debugOverlay);

      // Should call handleDebugSelection with coordinates, artifacts, and active tab
      expect(activeDebugHook.handleDebugSelection).toHaveBeenCalledWith(
        100, 200, 50, 75, mockArtifacts, 0
      );
    });

    test("should style debug button differently when debug mode is active", () => {
      const activeDebugHook = {
        ...mockDebugSelectionHook,
        debugMode: true,
      };
      mockedUseDebugSelection.mockReturnValue(activeDebugHook);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      const debugButton = screen.getByTitle("Debug Element");
      expect(debugButton).toHaveAttribute("data-variant", "default");
    });
  });

  describe("Recording Logic Functionality", () => {
    test("should render recording button when staktrak is setup", () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      const recordButton = screen.getByRole("button", { name: /start recording/i });
      expect(recordButton).toBeInTheDocument();
    });

    test("should not render recording button when staktrak is not setup", () => {
      const notSetupHook = {
        ...mockStaktrakHook,
        isSetup: false,
      };
      mockedUseStaktrak.mockReturnValue(notSetupHook);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      expect(screen.queryByRole("button", { name: /start recording/i })).not.toBeInTheDocument();
    });

    test("should start recording when record button is clicked", () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      const recordButton = screen.getByRole("button", { name: /start recording/i });
      fireEvent.click(recordButton);

      expect(mockStaktrakHook.startRecording).toHaveBeenCalledTimes(1);
    });

    test("should show stop recording button when recording is active", () => {
      const recordingHook = {
        ...mockStaktrakHook,
        isRecording: true,
      };
      mockedUseStaktrak.mockReturnValue(recordingHook);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      expect(screen.getByRole("button", { name: /stop recording/i })).toBeInTheDocument();
      expect(screen.getByTestId("square-icon")).toBeInTheDocument();
    });

    test("should stop recording and open test modal when stop button is clicked", async () => {
      const recordingHook = {
        ...mockStaktrakHook,
        isRecording: true,
      };
      mockedUseStaktrak.mockReturnValue(recordingHook);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      const stopButton = screen.getByRole("button", { name: /stop recording/i });
      fireEvent.click(stopButton);

      expect(recordingHook.stopRecording).toHaveBeenCalledTimes(1);
      
      await waitFor(() => {
        expect(screen.getByTestId("test-manager-modal")).toHaveAttribute("data-open", "true");
      });
    });

    test("should render assertion mode button when recording", () => {
      const recordingHook = {
        ...mockStaktrakHook,
        isRecording: true,
      };
      mockedUseStaktrak.mockReturnValue(recordingHook);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      expect(screen.getByRole("button", { name: /enable assertion mode/i })).toBeInTheDocument();
    });

    test("should toggle assertion mode when assertion button is clicked", () => {
      const recordingHook = {
        ...mockStaktrakHook,
        isRecording: true,
      };
      mockedUseStaktrak.mockReturnValue(recordingHook);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      const assertionButton = screen.getByRole("button", { name: /enable assertion mode/i });
      fireEvent.click(assertionButton);

      expect(recordingHook.enableAssertionMode).toHaveBeenCalledTimes(1);
    });

    test("should show disable assertion mode when assertion mode is active", () => {
      const assertionModeHook = {
        ...mockStaktrakHook,
        isRecording: true,
        isAssertionMode: true,
      };
      mockedUseStaktrak.mockReturnValue(assertionModeHook);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      // Find the button with target icon (which is shown when assertion mode is enabled)
      const buttons = screen.getAllByRole("button");
      const assertionButton = buttons.find(button => {
        const icon = button.querySelector('[data-testid="target-icon"]');
        return icon !== null;
      });

      expect(assertionButton).toBeTruthy();
      fireEvent.click(assertionButton!);

      expect(assertionModeHook.disableAssertionMode).toHaveBeenCalledTimes(1);
    });
  });

  describe("Replay Logic Functionality", () => {
    test("should render replay button when playwright test is available", () => {
      const testAvailableHook = {
        ...mockStaktrakHook,
        generatedPlaywrightTest: "test('example', async () => {});",
      };
      mockedUseStaktrak.mockReturnValue(testAvailableHook);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      // Find the button with play icon (which is shown when replaying is available)
      const buttons = screen.getAllByRole("button");
      const replayButton = buttons.find(button => {
        const icon = button.querySelector('[data-testid="play-icon"]');
        return icon !== null;
      });

      expect(replayButton).toBeTruthy();
      expect(screen.getByTestId("play-icon")).toBeInTheDocument();
    });

    test("should not render replay button when no playwright test is available", () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      // When no playwright test is available, there shouldn't be any play icons
      const buttons = screen.getAllByRole("button");
      const playButton = buttons.find(button => {
        const icon = button.querySelector('[data-testid="play-icon"]');
        return icon !== null;
      });

      expect(playButton).toBeFalsy();
      expect(screen.queryByTestId("play-icon")).not.toBeInTheDocument();
    });

    test("should start replay when replay button is clicked", () => {
      const testAvailableHook = {
        ...mockStaktrakHook,
        generatedPlaywrightTest: "test('example', async () => {});",
      };
      mockedUseStaktrak.mockReturnValue(testAvailableHook);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      // Find the button with play icon (which is shown when not replaying)
      const buttons = screen.getAllByRole("button");
      const replayButton = buttons.find(button => {
        const icon = button.querySelector('[data-testid="play-icon"]');
        return icon !== null;
      });

      expect(replayButton).toBeTruthy();
      fireEvent.click(replayButton!);

      expect(mockPlaywrightReplayHook.startPlaywrightReplay).toHaveBeenCalledWith(
        "test('example', async () => {});"
      );
    });

    test("should show stop replay button when replay is active", () => {
      const replayingHook = {
        ...mockPlaywrightReplayHook,
        isPlaywrightReplaying: true,
      };
      mockedUsePlaywrightReplay.mockReturnValue(replayingHook);

      const testAvailableHook = {
        ...mockStaktrakHook,
        generatedPlaywrightTest: "test('example', async () => {});",
      };
      mockedUseStaktrak.mockReturnValue(testAvailableHook);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      // Find the button with pause icon (which is shown when replaying)
      const buttons = screen.getAllByRole("button");
      const stopReplayButton = buttons.find(button => {
        const icon = button.querySelector('[data-testid="pause-icon"]');
        return icon !== null;
      });

      expect(stopReplayButton).toBeTruthy();
      expect(screen.getByTestId("pause-icon")).toBeInTheDocument();
    });

    test("should stop replay when stop button is clicked", () => {
      const replayingHook = {
        ...mockPlaywrightReplayHook,
        isPlaywrightReplaying: true,
      };
      mockedUsePlaywrightReplay.mockReturnValue(replayingHook);

      const testAvailableHook = {
        ...mockStaktrakHook,
        generatedPlaywrightTest: "test('example', async () => {});",
      };
      mockedUseStaktrak.mockReturnValue(testAvailableHook);

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      // Find the button with pause icon (which is shown when replaying)
      const buttons = screen.getAllByRole("button");
      const stopReplayButton = buttons.find(button => {
        const icon = button.querySelector('[data-testid="pause-icon"]');
        return icon !== null;
      });

      expect(stopReplayButton).toBeTruthy();
      fireEvent.click(stopReplayButton!);

      expect(replayingHook.stopPlaywrightReplay).toHaveBeenCalledTimes(1);
    });
  });

  describe("Integration Tests", () => {
    test("should handle empty artifacts array", () => {
      const { container } = render(<BrowserArtifactPanel artifacts={[]} />);
      expect(container.firstChild).toBeNull();
    });

    test("should render test manager modal", () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      expect(screen.getByTestId("test-manager-modal")).toBeInTheDocument();
    });

    test("should open test modal when tests button is clicked", () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      // Find the button with flask icon (Tests button)
      const buttons = screen.getAllByRole("button");
      const testsButton = buttons.find(button => {
        const icon = button.querySelector('[data-testid="flask-icon"]');
        return icon !== null;
      });

      expect(testsButton).toBeTruthy();
      fireEvent.click(testsButton!);

      expect(screen.getByTestId("test-manager-modal")).toHaveAttribute("data-open", "true");
    });

    test("should handle refresh button click", () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      // Find the button with refresh icon
      const buttons = screen.getAllByRole("button");
      const refreshButton = buttons.find(button => {
        const icon = button.querySelector('[data-testid="refresh-icon"]');
        return icon !== null;
      });

      expect(refreshButton).toBeTruthy();

      // Should not throw when clicked
      fireEvent.click(refreshButton!);
    });

    test("should handle external link button click", () => {
      const mockWindowOpen = vi.fn();
      Object.defineProperty(window, 'open', {
        writable: true,
        value: mockWindowOpen,
      });

      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} />);

      // Find the button with ExternalLink icon - look for a button with external link functionality
      const buttons = screen.getAllByRole("button");
      const externalLinkButton = buttons.find(button => {
        const svg = button.querySelector('svg[data-lucide="external-link"]') || 
                   button.querySelector('[data-testid="external-link-icon"]');
        return svg !== null;
      });

      expect(externalLinkButton).toBeTruthy();
      fireEvent.click(externalLinkButton!);

      expect(mockWindowOpen).toHaveBeenCalledWith("https://example.com", "_blank");
    });

    test("should pass onDebugMessage callback to useDebugSelection hook", () => {
      const mockOnDebugMessage = vi.fn();
      render(
        <BrowserArtifactPanel 
          artifacts={[mockArtifacts[0]]} 
          onDebugMessage={mockOnDebugMessage}
        />
      );

      expect(mockedUseDebugSelection).toHaveBeenCalledWith({
        onDebugMessage: mockOnDebugMessage,
        iframeRef: expect.any(Object),
      });
    });

    test("should handle IDE mode prop", () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifacts[0]]} ide={true} />);

      // In IDE mode, the toolbar should not be rendered
      expect(screen.queryByTestId("monitor-icon")).not.toBeInTheDocument();
    });
  });
});