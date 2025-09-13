import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/browser";
import { Artifact, ArtifactType, BrowserContent } from "@/lib/chat";

// Mock all dependencies
vi.mock("@/hooks/useStaktrak", () => ({
  useStaktrak: () => ({
    currentUrl: "https://example.com",
    iframeRef: { current: null },
    isSetup: true,
    isRecording: false,
    isAssertionMode: false,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    enableAssertionMode: vi.fn(),
    disableAssertionMode: vi.fn(),
    generatedPlaywrightTest: "test('generated', async ({ page }) => { await page.goto('https://example.com'); });",
    setGeneratedPlaywrightTest: vi.fn(),
  }),
}));

vi.mock("@/hooks/useStaktrakReplay", () => ({
  usePlaywrightReplay: () => ({
    isPlaywrightReplaying: false,
    startPlaywrightReplay: vi.fn(),
    stopPlaywrightReplay: vi.fn(),
  }),
}));

vi.mock("@/hooks/useDebugSelection", () => ({
  useDebugSelection: () => ({
    debugMode: false,
    isSubmittingDebug: false,
    setDebugMode: vi.fn(),
    handleDebugElement: vi.fn(),
    handleDebugSelection: vi.fn(),
  }),
}));

// Mock TestManagerModal with more realistic implementation
const mockTestManagerModal = vi.fn();
vi.mock("./TestManagerModal", () => ({
  TestManagerModal: (props: any) => {
    mockTestManagerModal(props);
    return props.isOpen ? (
      <div data-testid="test-manager-modal">
        <div data-testid="modal-content">
          <h2>Tests</h2>
          {props.generatedCode && (
            <div data-testid="generated-code">
              <pre>{props.generatedCode}</pre>
            </div>
          )}
          <div data-testid="initial-tab">{props.initialTab}</div>
          <button 
            data-testid="close-modal" 
            onClick={props.onClose}
          >
            Close
          </button>
          {props.onUserJourneySave && (
            <button
              data-testid="save-journey"
              onClick={() => props.onUserJourneySave("test-journey.spec.js", props.generatedCode)}
            >
              Save Journey
            </button>
          )}
        </div>
      </div>
    ) : null;
  },
}));

// Mock UI components
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, title, ...props }: any) => (
    <button onClick={onClick} title={title} {...props}>
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
  DebugOverlay: () => <div data-testid="debug-overlay" />,
}));

// Mock icons
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

describe("BrowserArtifactPanel TestManager Integration", () => {
  const mockArtifact: Artifact = {
    id: "artifact-1",
    messageId: "msg-1",
    type: ArtifactType.BROWSER,
    content: {
      url: "https://example.com",
    } as BrowserContent,
    icon: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Test Modal Integration", () => {
    test("should render test modal in closed state by default", () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      expect(screen.queryByTestId("test-manager-modal")).not.toBeInTheDocument();
      expect(mockTestManagerModal).toHaveBeenCalledWith(
        expect.objectContaining({
          isOpen: false,
        })
      );
    });

    test("should open test modal when tests button is clicked", async () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      const testsButton = screen.getByTitle("Tests");
      fireEvent.click(testsButton);

      await waitFor(() => {
        expect(screen.getByTestId("test-manager-modal")).toBeInTheDocument();
      });

      expect(mockTestManagerModal).toHaveBeenCalledWith(
        expect.objectContaining({
          isOpen: true,
          initialTab: "generated",
        })
      );
    });

    test("should close test modal when close is called", async () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      // Open modal
      const testsButton = screen.getByTitle("Tests");
      fireEvent.click(testsButton);

      await waitFor(() => {
        expect(screen.getByTestId("test-manager-modal")).toBeInTheDocument();
      });

      // Close modal
      const closeButton = screen.getByTestId("close-modal");
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByTestId("test-manager-modal")).not.toBeInTheDocument();
      });
    });

    test("should pass generated playwright test to modal", async () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      const testsButton = screen.getByTitle("Tests");
      fireEvent.click(testsButton);

      await waitFor(() => {
        expect(mockTestManagerModal).toHaveBeenCalledWith(
          expect.objectContaining({
            generatedCode: "test('generated', async ({ page }) => { await page.goto('https://example.com'); });",
          })
        );
      });

      // Verify generated code is displayed
      const generatedCode = screen.getByTestId("generated-code");
      expect(generatedCode).toHaveTextContent("test('generated', async ({ page })");
    });

    test("should set initial tab to 'generated' when test code exists", async () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      const testsButton = screen.getByTitle("Tests");
      fireEvent.click(testsButton);

      await waitFor(() => {
        expect(mockTestManagerModal).toHaveBeenCalledWith(
          expect.objectContaining({
            initialTab: "generated",
          })
        );
      });

      const initialTab = screen.getByTestId("initial-tab");
      expect(initialTab).toHaveTextContent("generated");
    });
  });

  describe("Recording Integration with Test Modal", () => {
    test("should open test modal after stopping recording", async () => {
      const mockUseStaktrak = await import("@/hooks/useStaktrak");
      const stopRecordingMock = vi.fn();
      
      vi.mocked(mockUseStaktrak.useStaktrak).mockReturnValue({
        currentUrl: "https://example.com",
        iframeRef: { current: null },
        isSetup: true,
        isRecording: true, // Currently recording
        isAssertionMode: false,
        startRecording: vi.fn(),
        stopRecording: stopRecordingMock,
        enableAssertionMode: vi.fn(),
        disableAssertionMode: vi.fn(),
        generatedPlaywrightTest: "",
        setGeneratedPlaywrightTest: vi.fn(),
      });

      render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      const stopButton = screen.getByTitle("Stop recording");
      fireEvent.click(stopButton);

      expect(stopRecordingMock).toHaveBeenCalledTimes(1);

      // Modal should open automatically after stopping
      await waitFor(() => {
        expect(screen.getByTestId("test-manager-modal")).toBeInTheDocument();
      });
    });

    test("should show empty generated code when recording has no results", async () => {
      const mockUseStaktrak = await import("@/hooks/useStaktrak");
      
      vi.mocked(mockUseStaktrak.useStaktrak).mockReturnValue({
        currentUrl: "https://example.com",
        iframeRef: { current: null },
        isSetup: true,
        isRecording: false,
        isAssertionMode: false,
        startRecording: vi.fn(),
        stopRecording: vi.fn(),
        enableAssertionMode: vi.fn(),
        disableAssertionMode: vi.fn(),
        generatedPlaywrightTest: "", // No generated test
        setGeneratedPlaywrightTest: vi.fn(),
      });

      render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      const testsButton = screen.getByTitle("Tests");
      fireEvent.click(testsButton);

      await waitFor(() => {
        expect(mockTestManagerModal).toHaveBeenCalledWith(
          expect.objectContaining({
            generatedCode: "",
          })
        );
      });
    });
  });

  describe("User Journey Save Integration", () => {
    test("should handle onUserJourneySave prop correctly", async () => {
      const mockOnUserJourneySave = vi.fn();

      render(
        <BrowserArtifactPanel 
          artifacts={[mockArtifact]} 
          onUserJourneySave={mockOnUserJourneySave}
        />
      );

      const testsButton = screen.getByTitle("Tests");
      fireEvent.click(testsButton);

      await waitFor(() => {
        expect(mockTestManagerModal).toHaveBeenCalledWith(
          expect.objectContaining({
            onUserJourneySave: mockOnUserJourneySave,
          })
        );
      });

      // Simulate saving a user journey
      const saveJourneyButton = screen.getByTestId("save-journey");
      fireEvent.click(saveJourneyButton);

      expect(mockOnUserJourneySave).toHaveBeenCalledWith(
        "test-journey.spec.js",
        "test('generated', async ({ page }) => { await page.goto('https://example.com'); });"
      );
    });

    test("should hide certain buttons when onUserJourneySave is provided", () => {
      const mockOnUserJourneySave = vi.fn();

      render(
        <BrowserArtifactPanel 
          artifacts={[mockArtifact]} 
          onUserJourneySave={mockOnUserJourneySave}
        />
      );

      // Tests button should not be visible when onUserJourneySave is provided
      expect(screen.queryByTitle("Tests")).not.toBeInTheDocument();
      
      // Debug button should not be visible when onUserJourneySave is provided
      expect(screen.queryByTitle("Debug Element")).not.toBeInTheDocument();
    });

    test("should show all buttons when onUserJourneySave is not provided", () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      // All buttons should be visible
      expect(screen.getByTitle("Tests")).toBeInTheDocument();
      expect(screen.getByTitle("Debug Element")).toBeInTheDocument();
      expect(screen.getByTitle("Refresh")).toBeInTheDocument();
      expect(screen.getByTitle("Open in new tab")).toBeInTheDocument();
    });
  });

  describe("Test Modal State Management", () => {
    test("should maintain modal state across component renders", async () => {
      const { rerender } = render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      // Open modal
      const testsButton = screen.getByTitle("Tests");
      fireEvent.click(testsButton);

      await waitFor(() => {
        expect(screen.getByTestId("test-manager-modal")).toBeInTheDocument();
      });

      // Re-render component
      rerender(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      // Modal should still be open
      expect(screen.getByTestId("test-manager-modal")).toBeInTheDocument();
    });

    test("should reset modal state when component unmounts", async () => {
      const { unmount } = render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      // Open modal
      const testsButton = screen.getByTitle("Tests");
      fireEvent.click(testsButton);

      await waitFor(() => {
        expect(screen.getByTestId("test-manager-modal")).toBeInTheDocument();
      });

      // Unmount component
      unmount();

      // Re-render component
      render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      // Modal should be closed
      expect(screen.queryByTestId("test-manager-modal")).not.toBeInTheDocument();
    });

    test("should handle multiple artifacts with modal state", async () => {
      const multipleArtifacts = [
        mockArtifact,
        {
          ...mockArtifact,
          id: "artifact-2",
          content: { url: "https://second.com" } as BrowserContent,
        },
      ];

      render(<BrowserArtifactPanel artifacts={multipleArtifacts} />);

      // Open modal on first tab
      const testsButton = screen.getByTitle("Tests");
      fireEvent.click(testsButton);

      await waitFor(() => {
        expect(screen.getByTestId("test-manager-modal")).toBeInTheDocument();
      });

      // Switch to second tab
      const secondTab = screen.getByText("Preview 2");
      fireEvent.click(secondTab);

      // Modal should still be open
      expect(screen.getByTestId("test-manager-modal")).toBeInTheDocument();
    });
  });

  describe("Error Handling", () => {
    test("should handle missing generated code gracefully", async () => {
      const mockUseStaktrak = await import("@/hooks/useStaktrak");
      
      vi.mocked(mockUseStaktrak.useStaktrak).mockReturnValue({
        currentUrl: "https://example.com",
        iframeRef: { current: null },
        isSetup: true,
        isRecording: false,
        isAssertionMode: false,
        startRecording: vi.fn(),
        stopRecording: vi.fn(),
        enableAssertionMode: vi.fn(),
        disableAssertionMode: vi.fn(),
        generatedPlaywrightTest: "", // No generated test
        setGeneratedPlaywrightTest: vi.fn(),
      });

      render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      const testsButton = screen.getByTitle("Tests");
      fireEvent.click(testsButton);

      await waitFor(() => {
        expect(mockTestManagerModal).toHaveBeenCalledWith(
          expect.objectContaining({
            generatedCode: "",
            initialTab: "saved", // Should default to "saved" when no generated code
          })
        );
      });
    });

    test("should handle modal errors gracefully", async () => {
      // Mock console.error to suppress expected error
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const TestManagerModalError = () => {
        throw new Error("Modal error");
      };

      vi.doMock("./TestManagerModal", () => ({
        TestManagerModal: TestManagerModalError,
      }));

      expect(() => {
        render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    test("should handle undefined onUserJourneySave callback", async () => {
      render(
        <BrowserArtifactPanel 
          artifacts={[mockArtifact]} 
          onUserJourneySave={undefined}
        />
      );

      // Tests button should be visible when onUserJourneySave is undefined
      expect(screen.getByTitle("Tests")).toBeInTheDocument();
    });
  });

  describe("Performance Considerations", () => {
    test("should not re-render modal unnecessarily", async () => {
      render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      const testsButton = screen.getByTitle("Tests");
      fireEvent.click(testsButton);

      await waitFor(() => {
        expect(screen.getByTestId("test-manager-modal")).toBeInTheDocument();
      });

      const initialCallCount = mockTestManagerModal.mock.calls.length;

      // Click refresh button (should not affect modal)
      const refreshButton = screen.getByTitle("Refresh");
      fireEvent.click(refreshButton);

      // Modal should not re-render
      expect(mockTestManagerModal.mock.calls.length).toBe(initialCallCount);
    });

    test("should properly cleanup modal state on unmount", () => {
      const { unmount } = render(<BrowserArtifactPanel artifacts={[mockArtifact]} />);

      // Unmount should not cause errors
      expect(() => unmount()).not.toThrow();
    });
  });
});