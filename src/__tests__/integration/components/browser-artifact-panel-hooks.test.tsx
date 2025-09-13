import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStaktrak } from "@/hooks/useStaktrak";
import { usePlaywrightReplay } from "@/hooks/useStaktrakReplay";
import { useDebugSelection } from "@/hooks/useDebugSelection";
import { Artifact, ArtifactType, BrowserContent } from "@/lib/chat";

// Mock window.PlaywrightGenerator
const mockPlaywrightGenerator = {
  generatePlaywrightTest: vi.fn().mockReturnValue("test('generated', () => {});"),
};

Object.defineProperty(window, 'PlaywrightGenerator', {
  writable: true,
  value: mockPlaywrightGenerator,
});

describe("BrowserArtifactPanel Hook Integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock iframe for hooks
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      writable: true,
      value: {
        postMessage: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("useStaktrak Hook Integration", () => {
    test("should initialize with correct default state", () => {
      const { result } = renderHook(() => useStaktrak("https://example.com"));

      expect(result.current.currentUrl).toBe("https://example.com");
      expect(result.current.isSetup).toBe(false);
      expect(result.current.isRecording).toBe(false);
      expect(result.current.isAssertionMode).toBe(false);
      expect(result.current.generatedPlaywrightTest).toBe("");
      expect(result.current.iframeRef).toBeDefined();
    });

    test("should handle startRecording correctly", () => {
      const { result } = renderHook(() => useStaktrak("https://example.com"));

      act(() => {
        result.current.startRecording();
      });

      expect(result.current.isRecording).toBe(true);
      expect(result.current.isAssertionMode).toBe(false);
    });

    test("should handle stopRecording correctly", () => {
      const { result } = renderHook(() => useStaktrak("https://example.com"));

      act(() => {
        result.current.startRecording();
      });

      expect(result.current.isRecording).toBe(true);

      act(() => {
        result.current.stopRecording();
      });

      expect(result.current.isRecording).toBe(false);
      expect(result.current.isAssertionMode).toBe(false);
    });

    test("should handle assertion mode correctly", () => {
      const { result } = renderHook(() => useStaktrak("https://example.com"));

      act(() => {
        result.current.enableAssertionMode();
      });

      expect(result.current.isAssertionMode).toBe(true);

      act(() => {
        result.current.disableAssertionMode();
      });

      expect(result.current.isAssertionMode).toBe(false);
    });

    test("should handle staktrak setup message", () => {
      const { result } = renderHook(() => useStaktrak("https://example.com"));

      expect(result.current.isSetup).toBe(false);

      // Simulate setup message
      act(() => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "staktrak-setup" }
        }));
      });

      expect(result.current.isSetup).toBe(true);
    });

    test("should handle staktrak results and generate playwright test", () => {
      const { result } = renderHook(() => useStaktrak("https://example.com"));

      expect(result.current.generatedPlaywrightTest).toBe("");

      const mockTrackingData = {
        clicks: { clickCount: 1, clickDetails: [] },
        time: { startedAt: Date.now(), completedAt: Date.now(), totalSeconds: 5 }
      };

      // Simulate results message
      act(() => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { 
            type: "staktrak-results",
            data: mockTrackingData
          }
        }));
      });

      expect(mockPlaywrightGenerator.generatePlaywrightTest).toHaveBeenCalledWith(
        "https://example.com",
        mockTrackingData
      );
      expect(result.current.generatedPlaywrightTest).toBe("test('generated', () => {});");
    });

    test("should handle page navigation messages", () => {
      const { result } = renderHook(() => useStaktrak("https://example.com"));

      expect(result.current.currentUrl).toBe("https://example.com");

      // Simulate page navigation message
      act(() => {
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            type: "staktrak-page-navigation",
            data: "https://navigated.com"
          }
        }));
      });

      expect(result.current.currentUrl).toBe("https://navigated.com");
    });

    test("should clean workspace URLs correctly", () => {
      const { result } = renderHook(() => 
        useStaktrak("@https://abc123-3000.workspaces.sphinx.chat")
      );

      const mockTrackingData = {
        clicks: { clickCount: 1, clickDetails: [] },
      };

      // Simulate results message which triggers URL cleaning
      act(() => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { 
            type: "staktrak-results",
            data: mockTrackingData
          }
        }));
      });

      expect(mockPlaywrightGenerator.generatePlaywrightTest).toHaveBeenCalledWith(
        "http://localhost:3000",
        mockTrackingData
      );
    });
  });

  describe("usePlaywrightReplay Hook Integration", () => {
    test("should initialize with correct default state", () => {
      const mockIframeRef = { current: document.createElement("iframe") };
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      expect(result.current.isPlaywrightReplaying).toBe(false);
      expect(result.current.isPlaywrightPaused).toBe(false);
      expect(result.current.playwrightStatus).toBe("idle");
      expect(result.current.playwrightProgress).toEqual({ current: 0, total: 0 });
      expect(result.current.currentAction).toBeNull();
      expect(result.current.replayErrors).toEqual([]);
    });

    test("should start replay with valid test code", () => {
      const mockIframe = document.createElement("iframe");
      mockIframe.contentWindow = { postMessage: vi.fn() } as any;
      const mockIframeRef = { current: mockIframe };

      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      const validTestCode = `
        test('example', async ({ page }) => {
          await page.goto('https://example.com');
          await page.click('button');
        });
      `;

      let startResult: boolean = false;
      act(() => {
        startResult = result.current.startPlaywrightReplay(validTestCode);
      });

      expect(startResult).toBe(true);
      expect(result.current.isPlaywrightReplaying).toBe(true);
      expect(result.current.playwrightStatus).toBe("playing");
      expect(mockIframe.contentWindow.postMessage).toHaveBeenCalledWith(
        {
          type: "staktrak-playwright-replay-start",
          testCode: validTestCode,
        },
        "*"
      );
    });

    test("should not start replay with invalid test code", () => {
      const mockIframe = document.createElement("iframe");
      mockIframe.contentWindow = { postMessage: vi.fn() } as any;
      const mockIframeRef = { current: mockIframe };

      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      let startResult: boolean = false;
      act(() => {
        startResult = result.current.startPlaywrightReplay("invalid code");
      });

      expect(startResult).toBe(false);
      expect(result.current.isPlaywrightReplaying).toBe(false);
    });

    test("should stop replay correctly", () => {
      const mockIframe = document.createElement("iframe");
      mockIframe.contentWindow = { postMessage: vi.fn() } as any;
      const mockIframeRef = { current: mockIframe };

      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      // Start replay first
      const validTestCode = "test('example', async ({ page }) => {});";
      act(() => {
        result.current.startPlaywrightReplay(validTestCode);
      });

      expect(result.current.isPlaywrightReplaying).toBe(true);

      // Stop replay
      act(() => {
        result.current.stopPlaywrightReplay();
      });

      expect(mockIframe.contentWindow.postMessage).toHaveBeenCalledWith(
        { type: "staktrak-playwright-replay-stop" },
        "*"
      );
      expect(result.current.isPlaywrightReplaying).toBe(false);
      expect(result.current.playwrightStatus).toBe("idle");
      expect(result.current.playwrightProgress).toEqual({ current: 0, total: 0 });
    });

    test("should handle pause and resume replay", () => {
      const mockIframe = document.createElement("iframe");
      mockIframe.contentWindow = { postMessage: vi.fn() } as any;
      const mockIframeRef = { current: mockIframe };

      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      // Start replay first
      const validTestCode = "test('example', async ({ page }) => {});";
      act(() => {
        result.current.startPlaywrightReplay(validTestCode);
      });

      // Pause replay
      act(() => {
        result.current.pausePlaywrightReplay();
      });

      expect(mockIframe.contentWindow.postMessage).toHaveBeenCalledWith(
        { type: "staktrak-playwright-replay-pause" },
        "*"
      );
      expect(result.current.isPlaywrightPaused).toBe(true);
      expect(result.current.playwrightStatus).toBe("paused");

      // Resume replay
      act(() => {
        result.current.resumePlaywrightReplay();
      });

      expect(mockIframe.contentWindow.postMessage).toHaveBeenCalledWith(
        { type: "staktrak-playwright-replay-resume" },
        "*"
      );
      expect(result.current.isPlaywrightPaused).toBe(false);
      expect(result.current.playwrightStatus).toBe("playing");
    });

    test("should handle replay progress messages", () => {
      const mockIframe = document.createElement("iframe");
      mockIframe.contentWindow = { postMessage: vi.fn() } as any;
      const mockIframeRef = { current: mockIframe };

      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      // Simulate progress message
      act(() => {
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            type: "staktrak-playwright-replay-progress",
            current: 3,
            total: 10,
            action: "click"
          }
        }));
      });

      expect(result.current.playwrightProgress).toEqual({ current: 3, total: 10 });
      expect(result.current.currentAction).toBe("click");
    });

    test("should handle replay completion messages", () => {
      const mockIframe = document.createElement("iframe");
      mockIframe.contentWindow = { postMessage: vi.fn() } as any;
      const mockIframeRef = { current: mockIframe };

      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      // Start replay first
      act(() => {
        result.current.startPlaywrightReplay("test('example', async ({ page }) => {});");
      });

      // Simulate completion message
      act(() => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "staktrak-playwright-replay-completed" }
        }));
      });

      expect(result.current.isPlaywrightReplaying).toBe(false);
      expect(result.current.playwrightStatus).toBe("completed");
      expect(result.current.currentAction).toBeNull();
    });

    test("should handle replay error messages", () => {
      const mockIframe = document.createElement("iframe");
      mockIframe.contentWindow = { postMessage: vi.fn() } as any;
      const mockIframeRef = { current: mockIframe };

      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      // Simulate error message
      act(() => {
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            type: "staktrak-playwright-replay-error",
            error: "Element not found",
            actionIndex: 2,
            action: "click button"
          }
        }));
      });

      expect(result.current.replayErrors).toHaveLength(1);
      expect(result.current.replayErrors[0]).toMatchObject({
        message: "Element not found",
        actionIndex: 2,
        action: "click button"
      });
    });
  });

  describe("useDebugSelection Hook Integration", () => {
    const mockOnDebugMessage = vi.fn();
    const mockIframeRef = { current: document.createElement("iframe") };

    test("should initialize with correct default state", () => {
      const { result } = renderHook(() => 
        useDebugSelection({ onDebugMessage: mockOnDebugMessage, iframeRef: mockIframeRef })
      );

      expect(result.current.debugMode).toBe(false);
      expect(result.current.isSubmittingDebug).toBe(false);
    });

    test("should toggle debug mode", () => {
      const { result } = renderHook(() => 
        useDebugSelection({ onDebugMessage: mockOnDebugMessage, iframeRef: mockIframeRef })
      );

      expect(result.current.debugMode).toBe(false);

      act(() => {
        result.current.handleDebugElement();
      });

      expect(result.current.debugMode).toBe(true);

      act(() => {
        result.current.handleDebugElement();
      });

      expect(result.current.debugMode).toBe(false);
    });

    test("should handle debug selection", async () => {
      const mockIframe = document.createElement("iframe");
      mockIframe.contentWindow = { postMessage: vi.fn() } as any;
      const debugMockIframeRef = { current: mockIframe };

      const { result } = renderHook(() => 
        useDebugSelection({ 
          onDebugMessage: mockOnDebugMessage, 
          iframeRef: debugMockIframeRef 
        })
      );

      const mockArtifacts: Artifact[] = [{
        id: "artifact-1",
        messageId: "msg-1", 
        type: ArtifactType.BROWSER,
        content: { url: "https://example.com" } as BrowserContent,
        icon: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }];

      act(() => {
        result.current.handleDebugSelection(100, 200, 50, 75, mockArtifacts, 0);
      });

      expect(result.current.isSubmittingDebug).toBe(true);
      
      // Should send debug request message
      expect(mockIframe.contentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "staktrak-debug-request",
          coordinates: { x: 100, y: 200, width: 50, height: 75 }
        }),
        "https://example.com"
      );

      // Simulate debug response
      act(() => {
        window.dispatchEvent(new MessageEvent("message", {
          origin: "https://example.com",
          data: {
            type: "staktrak-debug-response",
            messageId: expect.any(String),
            success: true,
            sourceFiles: [{
              file: "Component.tsx",
              lines: [10, 11, 12],
              context: "Button component",
              message: "Interactive button element found"
            }]
          }
        }));
      });

      await vi.waitFor(() => {
        expect(result.current.isSubmittingDebug).toBe(false);
        expect(result.current.debugMode).toBe(false);
        expect(mockOnDebugMessage).toHaveBeenCalledWith(
          "Interactive button element found",
          expect.objectContaining({
            type: ArtifactType.BUG_REPORT,
            content: expect.objectContaining({
              bugDescription: "Debug selection area 50×75 at coordinates (100, 200)",
              iframeUrl: "https://example.com",
              method: "selection",
              coordinates: { x: 100, y: 200, width: 50, height: 75 }
            })
          })
        );
      });
    });

    test("should handle debug click (zero dimensions)", async () => {
      const mockIframe = document.createElement("iframe");
      mockIframe.contentWindow = { postMessage: vi.fn() } as any;
      const debugMockIframeRef = { current: mockIframe };

      const { result } = renderHook(() => 
        useDebugSelection({ 
          onDebugMessage: mockOnDebugMessage, 
          iframeRef: debugMockIframeRef 
        })
      );

      const mockArtifacts: Artifact[] = [{
        id: "artifact-1",
        messageId: "msg-1", 
        type: ArtifactType.BROWSER,
        content: { url: "https://example.com" } as BrowserContent,
        icon: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }];

      act(() => {
        result.current.handleDebugSelection(150, 250, 0, 0, mockArtifacts, 0);
      });

      // Simulate debug response for click
      act(() => {
        window.dispatchEvent(new MessageEvent("message", {
          origin: "https://example.com",
          data: {
            type: "staktrak-debug-response",
            messageId: expect.any(String),
            success: true,
            sourceFiles: []
          }
        }));
      });

      await vi.waitFor(() => {
        expect(mockOnDebugMessage).toHaveBeenCalledWith(
          "Element analyzed",
          expect.objectContaining({
            content: expect.objectContaining({
              bugDescription: "Debug click at coordinates (150, 250)",
              method: "click"
            })
          })
        );
      });
    });

    test("should handle debug timeout", async () => {
      const mockIframe = document.createElement("iframe");
      mockIframe.contentWindow = { postMessage: vi.fn() } as any;
      const debugMockIframeRef = { current: mockIframe };

      const { result } = renderHook(() => 
        useDebugSelection({ 
          onDebugMessage: mockOnDebugMessage, 
          iframeRef: debugMockIframeRef 
        })
      );

      const mockArtifacts: Artifact[] = [{
        id: "artifact-1",
        messageId: "msg-1", 
        type: ArtifactType.BROWSER,
        content: { url: "https://example.com" } as BrowserContent,
        icon: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }];

      // Mock setTimeout to resolve immediately
      vi.spyOn(global, 'setTimeout').mockImplementationOnce((fn: any) => {
        fn();
        return 1;
      });

      act(() => {
        result.current.handleDebugSelection(100, 200, 50, 75, mockArtifacts, 0);
      });

      await vi.waitFor(() => {
        expect(result.current.isSubmittingDebug).toBe(false);
        expect(mockOnDebugMessage).toHaveBeenCalledWith(
          "Element analyzed",
          expect.objectContaining({
            content: expect.objectContaining({
              sourceFiles: [expect.objectContaining({
                file: "Source mapping will be available in future update"
              })]
            })
          })
        );
      });
    });
  });

  describe("Hook Error Handling", () => {
    test("useStaktrak should handle invalid URLs gracefully", () => {
      const { result } = renderHook(() => useStaktrak("invalid-url"));

      expect(result.current.currentUrl).toBe("invalid-url");
      expect(result.current.isSetup).toBe(false);
    });

    test("usePlaywrightReplay should handle null iframe gracefully", () => {
      const { result } = renderHook(() => usePlaywrightReplay({ current: null }));

      const startResult = result.current.startPlaywrightReplay("test code");
      expect(startResult).toBe(false);
      expect(result.current.isPlaywrightReplaying).toBe(false);
    });

    test("useDebugSelection should handle missing iframe gracefully", async () => {
      const { result } = renderHook(() => 
        useDebugSelection({ 
          onDebugMessage: mockOnDebugMessage, 
          iframeRef: { current: null }
        })
      );

      const mockArtifacts: Artifact[] = [{
        id: "artifact-1",
        messageId: "msg-1", 
        type: ArtifactType.BROWSER,
        content: { url: "https://example.com" } as BrowserContent,
        icon: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }];

      await act(async () => {
        await result.current.handleDebugSelection(100, 200, 50, 75, mockArtifacts, 0);
      });

      expect(result.current.isSubmittingDebug).toBe(false);
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        "🐛 Debug element analysis (with errors)",
        expect.objectContaining({
          content: expect.objectContaining({
            sourceFiles: [expect.objectContaining({
              file: "Error: Could not extract source information",
              context: "Iframe not found"
            })]
          })
        })
      );
    });
  });
});