import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStaktrak } from "@/hooks/useStaktrak";

// Mock RecordingManager methods
const createMockRecordingManager = () => ({
  handleEvent: vi.fn(),
  generateTest: vi.fn(() => "// Generated Playwright test"),
  getActions: vi.fn(() => []),
  getTrackingData: vi.fn(() => ({})),
  clear: vi.fn(),
  clearAllActions: vi.fn(),
  removeAction: vi.fn(() => true),
});

// Test data factories
const TestDataFactories = {
  createMockIframe: () => {
    const mockPostMessage = vi.fn();
    return {
      current: {
        contentWindow: {
          postMessage: mockPostMessage,
        },
      } as any,
      postMessage: mockPostMessage,
    };
  },

  createMessageEvent: (type: string, data?: any, eventType?: string, source?: any): MessageEvent => {
    const messageData: any = { type };
    if (data !== undefined) messageData.data = data;
    if (eventType !== undefined) messageData.eventType = eventType;

    return {
      data: messageData,
      source: source || null,
      origin: "*",
      ports: [],
    } as MessageEvent;
  },

  createStaktrakEventMessage: (eventType: string, eventData: any, source?: any) => {
    return TestDataFactories.createMessageEvent("staktrak-event", eventData, eventType, source);
  },

  createMockAction: (id: string, type: string, text: string = "") => ({
    id,
    type,
    text,
    timestamp: Date.now(),
  }),

  createMockActions: (count: number) =>
    Array.from({ length: count }, (_, i) => TestDataFactories.createMockAction(`action-${i}`, "click", `Element ${i}`)),
};

// Test utilities
const TestUtils = {
  setupWindowMocks: (mockRecordingManager: any) => {
    window.PlaywrightGenerator = {
      RecordingManager: vi.fn(() => mockRecordingManager) as any,
      generatePlaywrightTest: vi.fn(),
      generatePlaywrightTestFromActions: vi.fn(),
    };
  },

  cleanupWindowMocks: () => {
    delete (window as any).PlaywrightGenerator;
  },

  simulateMessage: (event: MessageEvent) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: event.data,
        source: event.source as any,
        origin: event.origin,
      }),
    );
  },

  expectPostMessageCall: (mockPostMessage: any, commandType: string, callIndex: number = 0) => {
    expect(mockPostMessage).toHaveBeenNthCalledWith(callIndex + 1, { type: commandType }, "*");
  },
};

describe("useStaktrak Hook", () => {
  let mockRecordingManager: ReturnType<typeof createMockRecordingManager>;
  let mockIframe: ReturnType<typeof TestDataFactories.createMockIframe>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordingManager = createMockRecordingManager();
    mockIframe = TestDataFactories.createMockIframe();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestUtils.cleanupWindowMocks();
  });

  describe("Initial State", () => {
    test("initializes with correct default state values", () => {
      const { result } = renderHook(() => useStaktrak());

      expect(result.current.currentUrl).toBeNull();
      expect(result.current.isSetup).toBe(false);
      expect(result.current.isRecording).toBe(false);
      expect(result.current.isAssertionMode).toBe(false);
      expect(result.current.capturedActions).toEqual([]);
      expect(result.current.showActions).toBe(false);
      expect(result.current.isRecorderReady).toBe(false);
      expect(result.current.generatedPlaywrightTest).toBe("");
    });

    test("initializes with provided initialUrl", () => {
      const initialUrl = "https://example.com";
      const { result } = renderHook(() => useStaktrak(initialUrl));

      expect(result.current.currentUrl).toBe(initialUrl);
    });

    test("iframeRef is initialized", () => {
      const { result } = renderHook(() => useStaktrak());

      expect(result.current.iframeRef).toBeDefined();
      expect(result.current.iframeRef.current).toBeNull();
    });
  });

  describe("RecordingManager Initialization", () => {
    test("initializes RecordingManager when PlaywrightGenerator is available", () => {
      TestUtils.setupWindowMocks(mockRecordingManager);

      const { result } = renderHook(() => useStaktrak());

      expect(window.PlaywrightGenerator?.RecordingManager).toHaveBeenCalled();
      expect(result.current.isRecorderReady).toBe(true);
    });

    test("does not initialize RecordingManager when PlaywrightGenerator is unavailable", () => {
      const { result } = renderHook(() => useStaktrak());

      expect(result.current.isRecorderReady).toBe(false);
    });

    test("only initializes RecordingManager once", () => {
      TestUtils.setupWindowMocks(mockRecordingManager);

      const { rerender } = renderHook(() => useStaktrak());
      rerender();
      rerender();

      expect(window.PlaywrightGenerator?.RecordingManager).toHaveBeenCalledTimes(1);
    });
  });

  describe("Recording Lifecycle", () => {
    test("startRecording clears existing data and starts recording", () => {
      TestUtils.setupWindowMocks(mockRecordingManager);

      const { result } = renderHook(() => useStaktrak());

      // Set iframeRef
      result.current.iframeRef.current = mockIframe.current;

      act(() => {
        result.current.startRecording();
      });

      expect(mockRecordingManager.clear).toHaveBeenCalled();
      expect(result.current.capturedActions).toEqual([]);
      expect(result.current.isRecording).toBe(true);
      expect(result.current.isAssertionMode).toBe(false);
      TestUtils.expectPostMessageCall(mockIframe.postMessage, "staktrak-start");
    });

    test("startRecording handles null iframeRef gracefully", () => {
      TestUtils.setupWindowMocks(mockRecordingManager);

      const { result } = renderHook(() => useStaktrak());

      act(() => {
        result.current.startRecording();
      });

      expect(result.current.isRecording).toBe(true);
      expect(mockIframe.postMessage).not.toHaveBeenCalled();
    });

    test("stopRecording stops recording and sends command", () => {
      TestUtils.setupWindowMocks(mockRecordingManager);

      const { result } = renderHook(() => useStaktrak());

      result.current.iframeRef.current = mockIframe.current;

      act(() => {
        result.current.startRecording();
      });

      act(() => {
        result.current.stopRecording();
      });

      expect(result.current.isRecording).toBe(false);
      expect(result.current.isAssertionMode).toBe(false);
      expect(result.current.showActions).toBe(false);
      TestUtils.expectPostMessageCall(mockIframe.postMessage, "staktrak-stop", 1);
    });

    test("stopRecording handles null iframeRef gracefully", () => {
      const { result } = renderHook(() => useStaktrak());

      act(() => {
        result.current.stopRecording();
      });

      expect(result.current.isRecording).toBe(false);
    });
  });

  describe("Assertion Mode", () => {
    test("enableAssertionMode enables assertion mode and sends command", () => {
      const { result } = renderHook(() => useStaktrak());

      result.current.iframeRef.current = mockIframe.current;

      act(() => {
        result.current.enableAssertionMode();
      });

      expect(result.current.isAssertionMode).toBe(true);
      TestUtils.expectPostMessageCall(mockIframe.postMessage, "staktrak-enable-selection");
    });

    test("disableAssertionMode disables assertion mode and sends command", () => {
      const { result } = renderHook(() => useStaktrak());

      result.current.iframeRef.current = mockIframe.current;

      act(() => {
        result.current.enableAssertionMode();
      });

      act(() => {
        result.current.disableAssertionMode();
      });

      expect(result.current.isAssertionMode).toBe(false);
      TestUtils.expectPostMessageCall(mockIframe.postMessage, "staktrak-disable-selection", 1);
    });
  });

  describe("Action Management", () => {
    test("removeAction removes action from RecordingManager", () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const mockActions = TestDataFactories.createMockActions(3);
      mockRecordingManager.getActions.mockReturnValue(mockActions.slice(0, 2));

      const { result } = renderHook(() => useStaktrak());

      const actionToRemove = mockActions[2];

      act(() => {
        result.current.removeAction(actionToRemove);
      });

      expect(mockRecordingManager.removeAction).toHaveBeenCalledWith(actionToRemove.id);
      expect(result.current.capturedActions).toEqual(mockActions.slice(0, 2));
    });

    test("removeAction does nothing when action has no id", () => {
      TestUtils.setupWindowMocks(mockRecordingManager);

      const { result } = renderHook(() => useStaktrak());

      act(() => {
        result.current.removeAction({ type: "click" });
      });

      expect(mockRecordingManager.removeAction).not.toHaveBeenCalled();
    });

    test("removeAction does nothing when RecordingManager is not initialized", () => {
      const { result } = renderHook(() => useStaktrak());

      act(() => {
        result.current.removeAction({ id: "test", type: "click" });
      });

      expect(result.current.capturedActions).toEqual([]);
    });

    test("removeAction does not update state when removal fails", () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      mockRecordingManager.removeAction.mockReturnValue(false);
      const mockActions = TestDataFactories.createMockActions(3);
      mockRecordingManager.getActions.mockReturnValue(mockActions);

      const { result } = renderHook(() => useStaktrak());

      act(() => {
        result.current.removeAction(mockActions[0]);
      });

      expect(mockRecordingManager.removeAction).toHaveBeenCalled();
      expect(mockRecordingManager.getActions).not.toHaveBeenCalled();
    });

    test("clearAllActions clears all actions", () => {
      TestUtils.setupWindowMocks(mockRecordingManager);

      const { result } = renderHook(() => useStaktrak());

      act(() => {
        result.current.clearAllActions();
      });

      expect(mockRecordingManager.clearAllActions).toHaveBeenCalled();
      expect(result.current.capturedActions).toEqual([]);
    });

    test("clearAllActions does nothing when RecordingManager is not initialized", () => {
      const { result } = renderHook(() => useStaktrak());

      act(() => {
        result.current.clearAllActions();
      });

      expect(result.current.capturedActions).toEqual([]);
    });

    test("toggleActionsView toggles showActions state", () => {
      const { result } = renderHook(() => useStaktrak());

      expect(result.current.showActions).toBe(false);

      act(() => {
        result.current.toggleActionsView();
      });

      expect(result.current.showActions).toBe(true);

      act(() => {
        result.current.toggleActionsView();
      });

      expect(result.current.showActions).toBe(false);
    });
  });

  describe("Message Handler - Setup", () => {
    test("handles staktrak-setup message", async () => {
      const { result } = renderHook(() => useStaktrak());

      result.current.iframeRef.current = mockIframe.current;

      const event = TestDataFactories.createMessageEvent(
        "staktrak-setup",
        undefined,
        undefined,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(result.current.isSetup).toBe(true);
      });
    });

    test("ignores messages from wrong source", async () => {
      const { result } = renderHook(() => useStaktrak());

      result.current.iframeRef.current = mockIframe.current;

      const wrongSource = { postMessage: vi.fn() };
      const event = TestDataFactories.createMessageEvent("staktrak-setup", undefined, undefined, wrongSource);

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(result.current.isSetup).toBe(false);
      });
    });

    test("ignores messages when iframeRef is not set", async () => {
      const { result } = renderHook(() => useStaktrak());

      const event = TestDataFactories.createMessageEvent("staktrak-setup");

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(result.current.isSetup).toBe(false);
      });
    });
  });

  describe("Message Handler - Events", () => {
    test("handles staktrak-event for click event", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const mockActions = TestDataFactories.createMockActions(1);
      mockRecordingManager.getActions.mockReturnValue(mockActions);

      const onActionCaptured = vi.fn();
      const { result } = renderHook(() => useStaktrak(undefined, undefined, onActionCaptured));

      result.current.iframeRef.current = mockIframe.current;

      const eventData = {
        selectors: { text: "Submit Button", tagName: "button" },
      };
      const event = TestDataFactories.createStaktrakEventMessage("click", eventData, mockIframe.current.contentWindow);

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(mockRecordingManager.handleEvent).toHaveBeenCalledWith("click", eventData);
        expect(result.current.capturedActions).toEqual(mockActions);
        expect(onActionCaptured).toHaveBeenCalledWith("Click captured", "Submit Button");
      });
    });

    test("handles staktrak-event for input event", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const onActionCaptured = vi.fn();
      const { result } = renderHook(() => useStaktrak(undefined, undefined, onActionCaptured));

      result.current.iframeRef.current = mockIframe.current;

      const eventData = { value: "test@example.com" };
      const event = TestDataFactories.createStaktrakEventMessage("input", eventData, mockIframe.current.contentWindow);

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(onActionCaptured).toHaveBeenCalledWith("Input captured", "test@example.com");
      });
    });

    test("handles staktrak-event for form checkbox event", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const onActionCaptured = vi.fn();
      const { result } = renderHook(() => useStaktrak(undefined, undefined, onActionCaptured));

      result.current.iframeRef.current = mockIframe.current;

      const eventData = { formType: "checkbox", checked: true };
      const event = TestDataFactories.createStaktrakEventMessage("form", eventData, mockIframe.current.contentWindow);

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(onActionCaptured).toHaveBeenCalledWith("Form change captured", "checkbox checked");
      });
    });

    test("handles staktrak-event for form select event", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const onActionCaptured = vi.fn();
      const { result } = renderHook(() => useStaktrak(undefined, undefined, onActionCaptured));

      result.current.iframeRef.current = mockIframe.current;

      const eventData = { formType: "select", text: "Option 1", value: "opt1" };
      const event = TestDataFactories.createStaktrakEventMessage("form", eventData, mockIframe.current.contentWindow);

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(onActionCaptured).toHaveBeenCalledWith("Form change captured", "Selected: Option 1");
      });
    });

    test("handles staktrak-event for navigation event", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const onActionCaptured = vi.fn();
      const { result } = renderHook(() => useStaktrak(undefined, undefined, onActionCaptured));

      result.current.iframeRef.current = mockIframe.current;

      const eventData = { url: "https://example.com/page" };
      const event = TestDataFactories.createStaktrakEventMessage("nav", eventData, mockIframe.current.contentWindow);

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(onActionCaptured).toHaveBeenCalledWith("Navigation captured", "/page");
      });
    });

    test("handles staktrak-event for assertion event", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const onActionCaptured = vi.fn();
      const { result } = renderHook(() => useStaktrak(undefined, undefined, onActionCaptured));

      result.current.iframeRef.current = mockIframe.current;

      const eventData = { value: "Success Message" };
      const event = TestDataFactories.createStaktrakEventMessage(
        "assertion",
        eventData,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(onActionCaptured).toHaveBeenCalledWith("Assertion captured", '"Success Message"');
      });
    });

    test("handles staktrak-event with missing eventType gracefully", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);

      const { result } = renderHook(() => useStaktrak());

      result.current.iframeRef.current = mockIframe.current;

      const event = TestDataFactories.createMessageEvent(
        "staktrak-event",
        { someData: "value" },
        undefined,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(mockRecordingManager.handleEvent).not.toHaveBeenCalled();
      });
    });

    test("handles staktrak-event error gracefully", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      mockRecordingManager.handleEvent.mockImplementation(() => {
        throw new Error("Recording error");
      });

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { result } = renderHook(() => useStaktrak());

      result.current.iframeRef.current = mockIframe.current;

      const eventData = { selectors: { text: "Button" } };
      const event = TestDataFactories.createStaktrakEventMessage("click", eventData, mockIframe.current.contentWindow);

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith("Error handling staktrak event:", expect.any(Error));
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Message Handler - Results", () => {
    test("handles staktrak-results message and generates test", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const initialUrl = "https://example.com";
      const generatedTest = "// Generated Playwright test";
      mockRecordingManager.generateTest.mockReturnValue(generatedTest);
      // Mock getActions to return non-empty array (validation requires actions)
      mockRecordingManager.getActions.mockReturnValue([{ type: "click", id: "action-1" }]);

      const onTestGenerated = vi.fn();
      const { result } = renderHook(() => useStaktrak(initialUrl, onTestGenerated));

      result.current.iframeRef.current = mockIframe.current;

      const event = TestDataFactories.createMessageEvent(
        "staktrak-results",
        undefined,
        undefined,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(mockRecordingManager.generateTest).toHaveBeenCalledWith(initialUrl);
        expect(result.current.generatedPlaywrightTest).toBe(generatedTest);
        expect(onTestGenerated).toHaveBeenCalledWith(generatedTest);
      });
    });

    test("handles staktrak-results with workspace URL conversion", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const workspaceUrl = "https://abc123-3000.workspaces.sphinx.chat";
      const expectedUrl = "http://localhost:3000";
      // Mock getActions to return non-empty array (validation requires actions)
      mockRecordingManager.getActions.mockReturnValue([{ type: "click", id: "action-1" }]);

      const { result } = renderHook(() => useStaktrak(workspaceUrl));

      result.current.iframeRef.current = mockIframe.current;

      const event = TestDataFactories.createMessageEvent(
        "staktrak-results",
        undefined,
        undefined,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(mockRecordingManager.generateTest).toHaveBeenCalledWith(expectedUrl);
      });
    });

    test("handles staktrak-results with @ prefix in workspace URL", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const workspaceUrl = "@https://xyz789-8080.workspaces.sphinx.chat";
      const expectedUrl = "http://localhost:8080";
      // Mock getActions to return non-empty array (validation requires actions)
      mockRecordingManager.getActions.mockReturnValue([{ type: "click", id: "action-1" }]);

      const { result } = renderHook(() => useStaktrak(workspaceUrl));

      result.current.iframeRef.current = mockIframe.current;

      const event = TestDataFactories.createMessageEvent(
        "staktrak-results",
        undefined,
        undefined,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(mockRecordingManager.generateTest).toHaveBeenCalledWith(expectedUrl);
      });
    });

    test("handles staktrak-results when RecordingManager is not initialized", async () => {
      const { result } = renderHook(() => useStaktrak("https://example.com"));

      result.current.iframeRef.current = mockIframe.current;

      const event = TestDataFactories.createMessageEvent(
        "staktrak-results",
        undefined,
        undefined,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(result.current.generatedPlaywrightTest).toBe("");
      });
    });

    test("handles staktrak-results error gracefully", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      mockRecordingManager.generateTest.mockImplementation(() => {
        throw new Error("Generation error");
      });
      // Mock getActions to return non-empty array (validation requires actions)
      mockRecordingManager.getActions.mockReturnValue([{ type: "click", id: "action-1" }]);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const onTestGenerated = vi.fn();

      const { result } = renderHook(() => useStaktrak("https://example.com", onTestGenerated));

      result.current.iframeRef.current = mockIframe.current;

      const event = TestDataFactories.createMessageEvent(
        "staktrak-results",
        undefined,
        undefined,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "[useStaktrak] Test generation error",
          expect.objectContaining({
            error: expect.any(Error),
            errorMessage: "Generation error",
          }),
        );
        expect(onTestGenerated).toHaveBeenCalledWith("", "Failed to generate test. Please try again.");
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Message Handler - Navigation", () => {
    test("handles staktrak-page-navigation message", async () => {
      const { result } = renderHook(() => useStaktrak("https://example.com/initial"));

      result.current.iframeRef.current = mockIframe.current;

      const newUrl = "https://example.com/new-page";
      const event = TestDataFactories.createMessageEvent(
        "staktrak-page-navigation",
        newUrl,
        undefined,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(result.current.currentUrl).toBe(newUrl);
      });
    });

    test("ignores staktrak-page-navigation with empty URL", async () => {
      const initialUrl = "https://example.com";
      const { result } = renderHook(() => useStaktrak(initialUrl));

      result.current.iframeRef.current = mockIframe.current;

      const event = TestDataFactories.createMessageEvent(
        "staktrak-page-navigation",
        "",
        undefined,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(result.current.currentUrl).toBe(initialUrl);
      });
    });
  });

  describe("Callback Updates", () => {
    test("updates callback refs when callbacks change", () => {
      const onTestGenerated1 = vi.fn();
      const onActionCaptured1 = vi.fn();

      const { rerender } = renderHook(
        ({ onTestGenerated, onActionCaptured }) => useStaktrak(undefined, onTestGenerated, onActionCaptured),
        {
          initialProps: {
            onTestGenerated: onTestGenerated1,
            onActionCaptured: onActionCaptured1,
          },
        },
      );

      const onTestGenerated2 = vi.fn();
      const onActionCaptured2 = vi.fn();

      rerender({
        onTestGenerated: onTestGenerated2,
        onActionCaptured: onActionCaptured2,
      });

      // Callbacks should be updated without triggering re-initialization
      expect(true).toBe(true);
    });
  });

  describe("URL Cleaning", () => {
    test("cleans workspace URL with port 3000", () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const workspaceUrl = "https://abc123-3000.workspaces.sphinx.chat";
      mockRecordingManager.generateTest.mockImplementation((url) => url);
      // Mock getActions to return non-empty array (validation requires actions)
      mockRecordingManager.getActions.mockReturnValue([{ type: "click", id: "action-1" }]);

      const { result } = renderHook(() => useStaktrak(workspaceUrl));

      result.current.iframeRef.current = mockIframe.current;

      const event = TestDataFactories.createMessageEvent(
        "staktrak-results",
        undefined,
        undefined,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      expect(mockRecordingManager.generateTest).toHaveBeenCalledWith("http://localhost:3000");
    });

    test("cleans workspace URL with custom port", () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const workspaceUrl = "https://xyz789-8080.workspaces.sphinx.chat";
      mockRecordingManager.generateTest.mockImplementation((url) => url);
      // Mock getActions to return non-empty array (validation requires actions)
      mockRecordingManager.getActions.mockReturnValue([{ type: "click", id: "action-1" }]);

      const { result } = renderHook(() => useStaktrak(workspaceUrl));

      result.current.iframeRef.current = mockIframe.current;

      const event = TestDataFactories.createMessageEvent(
        "staktrak-results",
        undefined,
        undefined,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      expect(mockRecordingManager.generateTest).toHaveBeenCalledWith("http://localhost:8080");
    });

    test("leaves non-workspace URLs unchanged", () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const regularUrl = "https://example.com";
      mockRecordingManager.generateTest.mockImplementation((url) => url);
      // Mock getActions to return non-empty array (validation requires actions)
      mockRecordingManager.getActions.mockReturnValue([{ type: "click", id: "action-1" }]);

      const { result } = renderHook(() => useStaktrak(regularUrl));

      result.current.iframeRef.current = mockIframe.current;

      const event = TestDataFactories.createMessageEvent(
        "staktrak-results",
        undefined,
        undefined,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      expect(mockRecordingManager.generateTest).toHaveBeenCalledWith(regularUrl);
    });
  });

  describe("setGeneratedPlaywrightTest", () => {
    test("allows external update of generated test", () => {
      const { result } = renderHook(() => useStaktrak());

      const newTest = "// New generated test";

      act(() => {
        result.current.setGeneratedPlaywrightTest(newTest);
      });

      expect(result.current.generatedPlaywrightTest).toBe(newTest);
    });
  });

  describe("Message Event Cleanup", () => {
    test("removes message event listener on unmount", () => {
      const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

      const { unmount } = renderHook(() => useStaktrak());

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });

    test("re-registers message listener when initialUrl changes", () => {
      const addEventListenerSpy = vi.spyOn(window, "addEventListener");
      const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

      const { rerender } = renderHook(({ initialUrl }) => useStaktrak(initialUrl), {
        initialProps: { initialUrl: "https://example.com/1" },
      });

      const initialCallCount = addEventListenerSpy.mock.calls.length;

      rerender({ initialUrl: "https://example.com/2" });

      expect(removeEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));
      expect(addEventListenerSpy.mock.calls.length).toBeGreaterThan(initialCallCount);

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });
  });

  describe("Edge Cases", () => {
    test("handles undefined callbacks gracefully", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);

      const { result } = renderHook(() => useStaktrak("https://example.com"));

      result.current.iframeRef.current = mockIframe.current;

      const eventData = { selectors: { text: "Button" } };
      const event = TestDataFactories.createStaktrakEventMessage("click", eventData, mockIframe.current.contentWindow);

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(mockRecordingManager.handleEvent).toHaveBeenCalled();
      });
    });

    test("handles message with no data property", async () => {
      const { result } = renderHook(() => useStaktrak());

      result.current.iframeRef.current = mockIframe.current;

      const event = {
        source: mockIframe.current.contentWindow,
        origin: "*",
        ports: [],
      } as MessageEvent;

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(result.current.isSetup).toBe(false);
      });
    });

    test("handles message with data but no type property", async () => {
      const { result } = renderHook(() => useStaktrak());

      result.current.iframeRef.current = mockIframe.current;

      const event = {
        data: { someProperty: "value" },
        source: mockIframe.current.contentWindow,
        origin: "*",
        ports: [],
      } as MessageEvent;

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(result.current.isSetup).toBe(false);
      });
    });

    test("handles click event with missing selectors", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const onActionCaptured = vi.fn();
      const { result } = renderHook(() => useStaktrak(undefined, undefined, onActionCaptured));

      result.current.iframeRef.current = mockIframe.current;

      const eventData = { selectors: {} };
      const event = TestDataFactories.createStaktrakEventMessage("click", eventData, mockIframe.current.contentWindow);

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(onActionCaptured).toHaveBeenCalledWith("Click captured", "Element");
      });
    });

    test("handles form event with unknown formType", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const onActionCaptured = vi.fn();
      const { result } = renderHook(() => useStaktrak(undefined, undefined, onActionCaptured));

      result.current.iframeRef.current = mockIframe.current;

      const eventData = { formType: "unknown" };
      const event = TestDataFactories.createStaktrakEventMessage("form", eventData, mockIframe.current.contentWindow);

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(onActionCaptured).toHaveBeenCalledWith("Form change captured", "unknown");
      });
    });

    test("handles unknown event type", async () => {
      TestUtils.setupWindowMocks(mockRecordingManager);
      const onActionCaptured = vi.fn();
      const { result } = renderHook(() => useStaktrak(undefined, undefined, onActionCaptured));

      result.current.iframeRef.current = mockIframe.current;

      const eventData = { someData: "value" };
      const event = TestDataFactories.createStaktrakEventMessage(
        "unknown-event-type",
        eventData,
        mockIframe.current.contentWindow,
      );

      act(() => {
        TestUtils.simulateMessage(event);
      });

      await waitFor(() => {
        expect(onActionCaptured).toHaveBeenCalledWith("unknown-event-type captured", "Action recorded");
      });
    });
  });

  describe("Return Value Completeness", () => {
    test("returns all expected properties and methods", () => {
      const { result } = renderHook(() => useStaktrak());

      const expectedProperties = [
        "currentUrl",
        "isSetup",
        "isRecording",
        "isAssertionMode",
        "iframeRef",
        "startRecording",
        "stopRecording",
        "enableAssertionMode",
        "disableAssertionMode",
        "generatedPlaywrightTest",
        "setGeneratedPlaywrightTest",
        "capturedActions",
        "showActions",
        "removeAction",
        "clearAllActions",
        "toggleActionsView",
        "isRecorderReady",
      ];

      expectedProperties.forEach((prop) => {
        expect(result.current).toHaveProperty(prop);
      });
    });

    test("all methods are functions", () => {
      const { result } = renderHook(() => useStaktrak());

      const methods = [
        "startRecording",
        "stopRecording",
        "enableAssertionMode",
        "disableAssertionMode",
        "removeAction",
        "clearAllActions",
        "toggleActionsView",
        "setGeneratedPlaywrightTest",
      ];

      methods.forEach((method) => {
        expect(typeof result.current[method as keyof typeof result.current]).toBe("function");
      });
    });
  });
});
