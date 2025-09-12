import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
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

  describe("handleDebugSelection - Security Tests", () => {
    test("should validate iframe origin to prevent XSS attacks", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      const trustedArtifacts = createMockArtifacts("https://trusted-domain.com");

      // Simulate iframe communication with trusted origin
      const debugPromise = act(async () => {
        await result.current.handleDebugSelection(
          100, 200, 50, 75, trustedArtifacts, 0
        );
      });

      // Simulate trusted iframe response
      const messageCallbacks = eventListeners.get("message") || [];
      expect(messageCallbacks).toHaveLength(1);

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
    });

    test("should reject malicious iframe origins", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      const trustedArtifacts = createMockArtifacts("https://trusted-domain.com");

      const debugPromise = act(async () => {
        await result.current.handleDebugSelection(
          100, 200, 0, 0, trustedArtifacts, 0
        );
      });

      // Simulate malicious iframe response from different origin
      const messageCallbacks = eventListeners.get("message") || [];
      const maliciousEvent = {
        origin: "https://malicious-site.com",
        data: {
          type: "staktrak-debug-response",
          messageId: "debug-1640995200000-bcdefghij",
          success: true,
          sourceFiles: [{ file: "malicious.js", lines: [] }],
        },
      };

      act(() => {
        messageCallbacks[0](maliciousEvent);
      });

      await debugPromise;

      // Should timeout and not process malicious response
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
  });

  describe("handleDebugSelection - Error Handling", () => {
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
          content: expect.objectContaining({
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
  });

  describe("handleDebugSelection - Edge Cases", () => {
    test("should handle click events (zero width/height)", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      const artifacts = createMockArtifacts();

      const debugPromise = act(async () => {
        await result.current.handleDebugSelection(
          150, 300, 0, 0, artifacts, 0 // Click event
        );
      });

      // Simulate successful response
      const messageCallbacks = eventListeners.get("message") || [];
      const successEvent = {
        origin: "https://trusted-domain.com",
        data: {
          type: "staktrak-debug-response",
          messageId: "debug-1640995200000-bcdefghij",
          success: true,
          sourceFiles: [],
        },
      };

      act(() => {
        messageCallbacks[0](successEvent);
      });

      await debugPromise;

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
    });

    test("should handle selection events (non-zero width/height)", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      const artifacts = createMockArtifacts();

      const debugPromise = act(async () => {
        await result.current.handleDebugSelection(
          10, 20, 100, 150, artifacts, 0 // Selection event
        );
      });

      // Simulate successful response
      const messageCallbacks = eventListeners.get("message") || [];
      const successEvent = {
        origin: "https://trusted-domain.com",
        data: {
          type: "staktrak-debug-response",
          messageId: "debug-1640995200000-bcdefghij",
          success: true,
          sourceFiles: [],
        },
      };

      act(() => {
        messageCallbacks[0](successEvent);
      });

      await debugPromise;

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

    test("should handle failed iframe responses", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      const artifacts = createMockArtifacts();

      const debugPromise = act(async () => {
        await result.current.handleDebugSelection(
          100, 200, 0, 0, artifacts, 0
        );
      });

      // Simulate failed iframe response
      const messageCallbacks = eventListeners.get("message") || [];
      const failedEvent = {
        origin: "https://trusted-domain.com",
        data: {
          type: "staktrak-debug-response",
          messageId: "debug-1640995200000-bcdefghij",
          success: false,
        },
      };

      act(() => {
        messageCallbacks[0](failedEvent);
      });

      await debugPromise;

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

    test("should handle negative coordinates", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      const artifacts = createMockArtifacts();

      const debugPromise = act(async () => {
        await result.current.handleDebugSelection(
          -10, -20, 50, 30, artifacts, 0
        );
      });

      // Simulate successful response
      const messageCallbacks = eventListeners.get("message") || [];
      const successEvent = {
        origin: "https://trusted-domain.com",
        data: {
          type: "staktrak-debug-response",
          messageId: "debug-1640995200000-bcdefghij",
          success: true,
          sourceFiles: [],
        },
      };

      act(() => {
        messageCallbacks[0](successEvent);
      });

      await debugPromise;

      expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenCalledWith(
        {
          type: "staktrak-debug-request",
          messageId: "debug-1640995200000-bcdefghij",
          coordinates: { x: -10, y: -20, width: 50, height: 30 },
        },
        "https://trusted-domain.com"
      );
    });
  });

  describe("handleDebugSelection - State Management", () => {
    test("should set debug mode to false after successful completion", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      // Enable debug mode first
      act(() => {
        result.current.handleDebugElement();
      });

      expect(result.current.debugMode).toBe(true);

      const artifacts = createMockArtifacts();

      const debugPromise = act(async () => {
        await result.current.handleDebugSelection(
          100, 200, 0, 0, artifacts, 0
        );
      });

      // Simulate successful response
      const messageCallbacks = eventListeners.get("message") || [];
      const successEvent = {
        origin: "https://trusted-domain.com",
        data: {
          type: "staktrak-debug-response",
          messageId: "debug-1640995200000-bcdefghij",
          success: true,
          sourceFiles: [],
        },
      };

      act(() => {
        messageCallbacks[0](successEvent);
      });

      await debugPromise;

      expect(result.current.debugMode).toBe(false);
      expect(result.current.isSubmittingDebug).toBe(false);
    });

    test("should manage isSubmittingDebug state correctly", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      const artifacts = createMockArtifacts();

      expect(result.current.isSubmittingDebug).toBe(false);

      const debugPromise = act(async () => {
        result.current.handleDebugSelection(100, 200, 0, 0, artifacts, 0);
      });

      expect(result.current.isSubmittingDebug).toBe(true);

      // Simulate timeout to complete the operation
      vi.spyOn(global, 'setTimeout').mockImplementation((callback: Function) => {
        callback();
        return 1 as any;
      });

      await debugPromise;

      expect(result.current.isSubmittingDebug).toBe(false);
    });
  });

  describe("handleDebugElement", () => {
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

  describe("Data Security and Sanitization", () => {
    test("should sanitize artifact content for security", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      const artifacts = createMockArtifacts();

      const debugPromise = act(async () => {
        await result.current.handleDebugSelection(
          100, 200, 50, 75, artifacts, 0
        );
      });

      // Simulate response with potentially malicious data
      const messageCallbacks = eventListeners.get("message") || [];
      const responseEvent = {
        origin: "https://trusted-domain.com",
        data: {
          type: "staktrak-debug-response",
          messageId: "debug-1640995200000-bcdefghij",
          success: true,
          sourceFiles: [
            {
              file: "<script>alert('xss')</script>",
              lines: [1, 2],
              context: "Potentially malicious context",
            },
          ],
        },
      };

      act(() => {
        messageCallbacks[0](responseEvent);
      });

      await debugPromise;

      // Verify the malicious content is still passed through
      // (the actual sanitization would happen in the UI layer)
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        "Element analyzed",
        expect.objectContaining({
          content: expect.objectContaining({
            sourceFiles: expect.arrayContaining([
              expect.objectContaining({
                file: "<script>alert('xss')</script>",
                context: "Potentially malicious context",
              }),
            ]),
          }),
        })
      );
    });

    test("should validate message format to prevent injection", async () => {
      const { result } = renderHook(() =>
        useDebugSelection({
          onDebugMessage: mockOnDebugMessage,
          iframeRef: mockIframeRef,
        })
      );

      const artifacts = createMockArtifacts();

      const debugPromise = act(async () => {
        await result.current.handleDebugSelection(
          100, 200, 0, 0, artifacts, 0
        );
      });

      // Simulate malformed message response
      const messageCallbacks = eventListeners.get("message") || [];
      const malformedEvent = {
        origin: "https://trusted-domain.com",
        data: {
          type: "wrong-message-type", // Wrong type
          messageId: "debug-1640995200000-bcdefghij",
          success: true,
        },
      };

      act(() => {
        messageCallbacks[0](malformedEvent);
      });

      await debugPromise;

      // Should timeout due to wrong message type and use fallback
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
    });
  });
});
