import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDebugSelection } from "@/hooks/useDebugSelection";
import {
  ArtifactType,
  BrowserContent,
  BugReportContent,
  Artifact,
} from "@/lib/chat";

// Mock URL constructor
Object.defineProperty(global, 'URL', {
  value: class MockURL {
    origin: string;
    constructor(url: string) {
      if (url.includes('malicious')) {
        this.origin = 'https://malicious-site.com';
      } else if (url.includes('trusted-domain')) {
        this.origin = 'https://trusted-domain.com';
      } else {
        this.origin = 'https://example.com'; // fallback
      }
    }
  },
  writable: true
});

// Mock refs and DOM APIs
const createMockIframe = (contentWindow?: any) => ({
  current: {
    contentWindow: contentWindow || {
      postMessage: vi.fn(),
    },
  },
});

const createMockArtifacts = (url = "https://trusted-domain.com"): Artifact[] => [
  {
    id: "artifact-1",
    messageId: "msg-1",
    type: ArtifactType.BROWSER,
    content: { url } as BrowserContent,
    icon: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe("useDebugSelection", () => {
  let mockOnDebugMessage: vi.MockedFunction<any>;
  let mockIframeRef: any;
  let originalAddEventListener: any;
  let originalRemoveEventListener: any;
  let eventListeners: Map<string, Function[]>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockOnDebugMessage = vi.fn();
    mockIframeRef = createMockIframe();
    
    // Mock window event listeners
    eventListeners = new Map();
    originalAddEventListener = window.addEventListener;
    originalRemoveEventListener = window.removeEventListener;
    
    window.addEventListener = vi.fn((event: string, callback: Function) => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, []);
      }
      eventListeners.get(event)!.push(callback);
    });
    
    window.removeEventListener = vi.fn((event: string, callback: Function) => {
      if (eventListeners.has(event)) {
        const callbacks = eventListeners.get(event)!;
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    });

    // Mock URL constructor for iframe origin validation
    global.URL = class MockURL {
      origin: string;
      constructor(url: string) {
        if (url.includes('malicious')) {
          this.origin = 'https://malicious-site.com';
        } else if (url.includes('trusted-domain')) {
          this.origin = 'https://trusted-domain.com';
        } else {
          this.origin = new URL(url).origin;
        }
      }
    } as any;

    // Mock Math.random for predictable IDs
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
    
    // Mock Date.now for consistent timestamps
    vi.spyOn(Date, 'now').mockReturnValue(1640995200000); // 2022-01-01
  });

  afterEach(() => {
    window.addEventListener = originalAddEventListener;
    window.removeEventListener = originalRemoveEventListener;
    vi.restoreAllMocks();
  });

  describe("Basic functionality", () => {
    test("should initialize with correct default state", () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      expect(result.current.debugMode).toBe(false);
      expect(result.current.isSubmittingDebug).toBe(false);
      expect(typeof result.current.handleDebugElement).toBe('function');
      expect(typeof result.current.handleDebugSelection).toBe('function');
    });

    test("should toggle debug mode", () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
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
  });

  describe("handleDebugSelection - Error handling", () => {
    test("should handle missing iframe reference", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: { current: null }, // No iframe
        })
      );

      const artifacts = createMockArtifacts();

      await act(async () => {
        await result.current.handleDebugSelection(
          100, 200, 0, 0, artifacts, 0
        );
      });

      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        expect.stringContaining("🐛 Debug element analysis (with errors)"),
        expect.objectContaining({
          type: ArtifactType.BUG_REPORT,
          content: expect.objectContaining({
            bugDescription: "Debug analysis failed at (100, 200)",
            sourceFiles: expect.arrayContaining([
              expect.objectContaining({
                file: "Error: Could not extract source information",
                context: "Iframe not found",
              }),
            ]),
          }),
        })
      );
    });

    test("should handle iframe postMessage failure", async () => {
      const mockContentWindow = {
        postMessage: vi.fn().mockImplementation(() => {
          throw new Error("postMessage failed");
        }),
      };
      
      const failingIframeRef = createMockIframe(mockContentWindow);
      
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: failingIframeRef,
        })
      );

      const artifacts = createMockArtifacts();

      await act(async () => {
        await result.current.handleDebugSelection(
          100, 200, 0, 0, artifacts, 0
        );
      });

      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        expect.stringContaining("🐛 Debug element analysis (with errors)"),
        expect.objectContaining({
          content: expect.objectContaining({
            sourceFiles: expect.arrayContaining([
              expect.objectContaining({
                file: "Error: Could not extract source information",
                context: "postMessage failed",
              }),
            ]),
          }),
        })
      );
    });

    test("should handle malformed iframe URLs securely", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      // Create artifacts with malformed URL that should trigger error handling
      const malformedArtifacts = createMockArtifacts("javascript:alert('xss')");

      await act(async () => {
        await result.current.handleDebugSelection(
          100, 200, 0, 0, malformedArtifacts, 0
        );
      });

      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        expect.stringContaining("🐛 Debug element analysis (with errors)"),
        expect.objectContaining({
          type: ArtifactType.BUG_REPORT,
          content: expect.objectContaining({
            bugDescription: "Debug analysis failed at (100, 200)",
            sourceFiles: expect.arrayContaining([
              expect.objectContaining({
                file: "Error: Could not extract source information",
              }),
            ]),
          }),
        })
      );
    });

    test("should handle iframe communication timeout", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      const artifacts = createMockArtifacts();

      // Mock setTimeout to trigger timeout immediately
      vi.spyOn(global, 'setTimeout').mockImplementation((callback: Function) => {
        callback();
        return 1 as any;
      });

      await act(async () => {
        await result.current.handleDebugSelection(
          100, 200, 50, 75, artifacts, 0
        );
      });

      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        "Element analyzed",
        expect.objectContaining({
          content: expect.objectContaining({
            sourceFiles: expect.arrayContaining([
              expect.objectContaining({
                file: "Source mapping will be available in future update",
                context: "Debug UI preview - actual source mapping implementation coming soon",
              }),
            ]),
          }),
        })
      );
    });
  });

  describe("handleDebugSelection - Success scenarios", () => {
    test("should validate iframe origin and process trusted response", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      const trustedArtifacts = createMockArtifacts("https://trusted-domain.com");

      // Start the debug selection process
      const debugPromise = result.current.handleDebugSelection(
        100, 200, 50, 75, trustedArtifacts, 0
      );

      // Wait for the message listener to be set up
      await waitFor(() => {
        const messageCallbacks = eventListeners.get("message") || [];
        expect(messageCallbacks).toHaveLength(1);
      });

      // Simulate trusted iframe response
      const messageCallbacks = eventListeners.get("message") || [];
      const trustedEvent = {
        origin: "https://trusted-domain.com",
        data: {
          type: "staktrak-debug-response",
          messageId: "debug-1640995200000-bcdefghij",
          success: true,
          sourceFiles: [
            {
              file: "trusted-component.tsx",
              lines: [42, 43],
              context: "Button component",
            },
          ],
        },
      };

      // Trigger the message event
      act(() => {
        messageCallbacks[0](trustedEvent);
      });

      await debugPromise;

      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        "Element analyzed",
        expect.objectContaining({
          type: ArtifactType.BUG_REPORT,
          content: expect.objectContaining({
            bugDescription: "Debug selection area 50×75 at coordinates (100, 200)",
            iframeUrl: "https://trusted-domain.com",
            sourceFiles: expect.arrayContaining([
              expect.objectContaining({
                file: "trusted-component.tsx",
                lines: [42, 43],
                context: "Button component",
              }),
            ]),
          }),
        })
      );
    }, 10000);

    test("should handle click events vs selection events", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      const artifacts = createMockArtifacts();

      // Mock timeout to simulate quick completion
      vi.spyOn(global, 'setTimeout').mockImplementation((callback: Function) => {
        setTimeout(callback, 10);
        return 1 as any;
      });

      // Test click event (zero width/height)
      await act(async () => {
        await result.current.handleDebugSelection(
          150, 300, 0, 0, artifacts, 0
        );
      });

      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        "Element analyzed",
        expect.objectContaining({
          content: expect.objectContaining({
            bugDescription: "Debug click at coordinates (150, 300)",
            method: "click",
            coordinates: { x: 150, y: 300, width: 0, height: 0 },
          }),
        })
      );

      mockOnDebugMessage.mockClear();

      // Test selection event (non-zero width/height)  
      await act(async () => {
        await result.current.handleDebugSelection(
          10, 20, 100, 150, artifacts, 0
        );
      });

      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        "Element analyzed",
        expect.objectContaining({
          content: expect.objectContaining({
            bugDescription: "Debug selection area 100×150 at coordinates (10, 20)",
            method: "selection",
            coordinates: { x: 10, y: 20, width: 100, height: 150 },
          }),
        })
      );
    });
  });

  describe("Security validation", () => {
    test("should reject malicious iframe origins", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      const trustedArtifacts = createMockArtifacts("https://trusted-domain.com");

      // Start debug process
      const debugPromise = result.current.handleDebugSelection(
        100, 200, 0, 0, trustedArtifacts, 0
      );

      // Wait for message listener 
      await waitFor(() => {
        const messageCallbacks = eventListeners.get("message") || [];
        expect(messageCallbacks).toHaveLength(1);
      });

      // Simulate malicious response from different origin
      const messageCallbacks = eventListeners.get("message") || [];
      const maliciousEvent = {
        origin: "https://malicious-site.com", // Different from artifact URL
        data: {
          type: "staktrak-debug-response",
          messageId: "debug-1640995200000-bcdefghij",
          success: true,
          sourceFiles: [{ file: "malicious.js", lines: [] }],
        },
      };

      // Trigger malicious event (should be ignored)
      act(() => {
        messageCallbacks[0](maliciousEvent);
      });

      // Let timeout occur to complete the promise
      await new Promise(resolve => setTimeout(resolve, 50));

      await debugPromise;

      // Should have fallen back to default response (not the malicious one)
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        "Element analyzed",
        expect.objectContaining({
          content: expect.objectContaining({
            sourceFiles: expect.arrayContaining([
              expect.objectContaining({
                file: "Source mapping will be available in future update",
              }),
            ]),
          }),
        })
      );
    }, 10000);
  });
});
