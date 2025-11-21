import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { usePlaywrightReplay } from "@/hooks/useStaktrakReplay";

describe("usePlaywrightReplay", () => {
  // Test data factories
  const TestDataFactories = {
    createMockIframeRef: (withContentWindow = true) => ({
      current: withContentWindow
        ? {
            contentWindow: {
              postMessage: vi.fn(),
            },
          }
        : null,
    }),

    createValidPlaywrightTest: () => `
      test('sample test', async ({ page }) => {
        await page.goto('https://example.com');
        await page.click('button');
      });
    `,

    createInvalidPlaywrightTest: {
      missingPage: () => `test('no page usage', async ({ }) => { });`,
      missingTest: () => `async function notATest({ page }) { await page.click('button'); }`,
      empty: () => "",
      nonString: () => null as unknown,
    },

    createMessageEvent: (type: string, data: Record<string, unknown> = {}) =>
      new MessageEvent("message", {
        data: { type, ...data },
      }),
  };

  // Test utilities
  const TestUtils = {
    simulateMessageEvent: (eventData: Record<string, unknown> & { type: string }) => {
      const event = TestDataFactories.createMessageEvent(eventData.type, eventData);
      window.dispatchEvent(event);
    },

    expectInitialState: (result: { current: Record<string, unknown> }) => {
      expect(result.current.isPlaywrightReplaying).toBe(false);
      expect(result.current.isPlaywrightPaused).toBe(false);
      expect(result.current.playwrightStatus).toBe("idle");
      expect(result.current.playwrightProgress).toEqual({ current: 0, total: 0 });
      expect(result.current.currentAction).toBeNull();
      expect(result.current.replayErrors).toEqual([]);
    },
  };

  let mockIframeRef: { current: { contentWindow: { postMessage: ReturnType<typeof vi.fn> } } | null };
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let querySelectors: Map<
    string,
    {
      classList: {
        add: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
        contains: ReturnType<typeof vi.fn>;
      };
    }
  >;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock console methods
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Mock DOM querySelector
    querySelectors = new Map();
    vi.spyOn(document, "querySelector").mockImplementation((selector: string) => {
      if (!querySelectors.has(selector)) {
        const mockElement = {
          classList: {
            add: vi.fn(),
            remove: vi.fn(),
            contains: vi.fn(),
          },
        };
        querySelectors.set(selector, mockElement);
      }
      return querySelectors.get(selector) || null;
    });

    // Create fresh mock iframe ref
    mockIframeRef = TestDataFactories.createMockIframeRef();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe("Initial State", () => {
    test("should initialize with correct default state", () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      TestUtils.expectInitialState(result);
    });

    test("should return all expected control functions", () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      expect(result.current.startPlaywrightReplay).toBeInstanceOf(Function);
      expect(result.current.pausePlaywrightReplay).toBeInstanceOf(Function);
      expect(result.current.resumePlaywrightReplay).toBeInstanceOf(Function);
      expect(result.current.stopPlaywrightReplay).toBeInstanceOf(Function);
    });
  });

  describe("startPlaywrightReplay", () => {
    describe("Validation", () => {
      test("should return false when iframe ref is null", () => {
        const nullRef = { current: null };
        const { result } = renderHook(() => usePlaywrightReplay(nullRef));

        let success: boolean;
        act(() => {
          success = result.current.startPlaywrightReplay("test code");
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });

      test("should return false when iframe has no contentWindow", () => {
        const invalidRef = { current: {} as { contentWindow?: { postMessage: () => void } } };
        const { result } = renderHook(() => usePlaywrightReplay(invalidRef));

        let success: boolean;
        act(() => {
          success = result.current.startPlaywrightReplay("test code");
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });

      test("should return false when testCode is empty string", () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        let success: boolean;
        act(() => {
          success = result.current.startPlaywrightReplay("");
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });

      test("should return false when testCode is not a string", () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        let success: boolean;
        act(() => {
          success = result.current.startPlaywrightReplay(null as unknown as string);
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });

      test('should return false when testCode does not contain "page."', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const invalidCode = TestDataFactories.createInvalidPlaywrightTest.missingPage();

        let success: boolean;
        act(() => {
          success = result.current.startPlaywrightReplay(invalidCode);
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });

      test('should return false when testCode does not contain "test("', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const invalidCode = TestDataFactories.createInvalidPlaywrightTest.missingTest();

        let success: boolean;
        act(() => {
          success = result.current.startPlaywrightReplay(invalidCode);
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });
    });

    describe("Successful Start", () => {
      test("should start replay with valid test code", () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        let success: boolean;
        act(() => {
          success = result.current.startPlaywrightReplay(validCode);
        });

        expect(success!).toBe(true);
        expect(result.current.isPlaywrightReplaying).toBe(true);
        expect(result.current.isPlaywrightPaused).toBe(false);
        expect(result.current.playwrightStatus).toBe("playing");
      });

      test("should send postMessage to iframe with correct payload", () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        act(() => result.current.startPlaywrightReplay(validCode));

        expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenCalledWith(
          {
            type: "staktrak-playwright-replay-start",
            testCode: validCode,
          },
          "*",
        );
      });

      test("should reset errors and current action on start", () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Simulate existing errors and action
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-error",
            error: "Previous error",
            actionIndex: 0,
            action: "click",
          });
        });

        // Start new replay
        const validCode = TestDataFactories.createValidPlaywrightTest();
        act(() => result.current.startPlaywrightReplay(validCode));

        expect(result.current.replayErrors).toEqual([]);
        expect(result.current.currentAction).toBeNull();
      });

      test('should add "playwright-replaying" class to iframe-container', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        act(() => result.current.startPlaywrightReplay(validCode));

        const container = querySelectors.get(".iframe-container");
        expect(container?.classList.add).toHaveBeenCalledWith("playwright-replaying");
      });
    });

    describe("Error Handling", () => {
      test("should handle postMessage errors gracefully", () => {
        const errorRef = {
          current: {
            contentWindow: {
              postMessage: vi.fn().mockImplementation(() => {
                throw new Error("PostMessage failed");
              }),
            },
          },
        };
        const { result } = renderHook(() => usePlaywrightReplay(errorRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        let success: boolean;
        act(() => {
          success = result.current.startPlaywrightReplay(validCode);
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
        expect(consoleErrorSpy).toHaveBeenCalledWith("Error starting Playwright replay:", expect.any(Error));
      });

      test('should remove "playwright-replaying" class on error', () => {
        const errorRef = {
          current: {
            contentWindow: {
              postMessage: vi.fn().mockImplementation(() => {
                throw new Error("PostMessage failed");
              }),
            },
          },
        };
        const { result } = renderHook(() => usePlaywrightReplay(errorRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        act(() => result.current.startPlaywrightReplay(validCode));

        const container = querySelectors.get(".iframe-container");
        expect(container?.classList.remove).toHaveBeenCalledWith("playwright-replaying");
      });
    });
  });

  describe("previewPlaywrightReplay", () => {
    describe("Validation", () => {
      test("should return false when iframe ref is null", () => {
        const nullRef = { current: null };
        const { result } = renderHook(() => usePlaywrightReplay(nullRef));

        let success: boolean;
        act(() => {
          success = result.current.previewPlaywrightReplay("test code");
        });

        expect(success!).toBe(false);
      });

      test("should return false when iframe has no contentWindow", () => {
        const invalidRef = { current: {} as { contentWindow?: { postMessage: () => void } } };
        const { result } = renderHook(() => usePlaywrightReplay(invalidRef));

        let success: boolean;
        act(() => {
          success = result.current.previewPlaywrightReplay("test code");
        });

        expect(success!).toBe(false);
      });

      test("should return false when testCode is empty string", () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        let success: boolean;
        act(() => {
          success = result.current.previewPlaywrightReplay("");
        });

        expect(success!).toBe(false);
      });

      test("should return false when testCode is not a string", () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        let success: boolean;
        act(() => {
          success = result.current.previewPlaywrightReplay(null as unknown as string);
        });

        expect(success!).toBe(false);
      });

      test('should return false when testCode does not contain "page."', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const invalidCode = TestDataFactories.createInvalidPlaywrightTest.missingPage();

        let success: boolean;
        act(() => {
          success = result.current.previewPlaywrightReplay(invalidCode);
        });

        expect(success!).toBe(false);
      });

      test('should return false when testCode does not contain "test("', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const invalidCode = TestDataFactories.createInvalidPlaywrightTest.missingTest();

        let success: boolean;
        act(() => {
          success = result.current.previewPlaywrightReplay(invalidCode);
        });

        expect(success!).toBe(false);
      });
    });

    describe("Successful Preview", () => {
      test("should send postMessage with preview type", () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        act(() => result.current.previewPlaywrightReplay(validCode));

        expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenCalledWith(
          {
            type: "staktrak-playwright-replay-preview",
            testCode: validCode,
          },
          "*",
        );
      });

      test("should not change replay state when previewing", () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        act(() => result.current.previewPlaywrightReplay(validCode));

        expect(result.current.isPlaywrightReplaying).toBe(false);
        expect(result.current.isPlaywrightPaused).toBe(false);
        expect(result.current.playwrightStatus).toBe("idle");
      });
    });

    describe("Error Handling", () => {
      test("should handle postMessage errors gracefully", () => {
        const errorRef = {
          current: {
            contentWindow: {
              postMessage: vi.fn().mockImplementation(() => {
                throw new Error("PostMessage failed");
              }),
            },
          },
        };
        const { result } = renderHook(() => usePlaywrightReplay(errorRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        let success: boolean;
        act(() => {
          success = result.current.previewPlaywrightReplay(validCode);
        });

        expect(success!).toBe(false);
        expect(consoleErrorSpy).toHaveBeenCalledWith("Error previewing Playwright test:", expect.any(Error));
      });
    });
  });

  describe("pausePlaywrightReplay", () => {
    test("should do nothing when not replaying", () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      act(() => result.current.pausePlaywrightReplay());

      expect(mockIframeRef.current.contentWindow.postMessage).not.toHaveBeenCalled();
      expect(result.current.isPlaywrightPaused).toBe(false);
    });

    test("should do nothing when iframe ref is null", () => {
      const nullRef = { current: null };
      const { result } = renderHook(() => usePlaywrightReplay(nullRef));

      act(() => result.current.pausePlaywrightReplay());

      expect(result.current.isPlaywrightPaused).toBe(false);
    });

    test("should send pause message when replaying", () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Start replay first
      act(() => result.current.startPlaywrightReplay(validCode));

      // Then pause
      act(() => result.current.pausePlaywrightReplay());

      expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenCalledWith(
        { type: "staktrak-playwright-replay-pause" },
        "*",
      );
      expect(result.current.isPlaywrightPaused).toBe(true);
      expect(result.current.playwrightStatus).toBe("paused");
    });

    test("should handle postMessage errors", () => {
      const errorRef = {
        current: {
          contentWindow: {
            postMessage: vi.fn(),
          },
        },
      };
      const { result } = renderHook(() => usePlaywrightReplay(errorRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Start replay
      act(() => result.current.startPlaywrightReplay(validCode));

      // Make postMessage throw on pause
      errorRef.current.contentWindow.postMessage.mockImplementation(() => {
        throw new Error("PostMessage failed");
      });

      act(() => result.current.pausePlaywrightReplay());

      expect(consoleErrorSpy).toHaveBeenCalledWith("Error pausing Playwright replay:", expect.any(Error));
    });
  });

  describe("resumePlaywrightReplay", () => {
    test("should do nothing when not replaying", () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      act(() => result.current.resumePlaywrightReplay());

      expect(mockIframeRef.current.contentWindow.postMessage).not.toHaveBeenCalled();
    });

    test("should do nothing when not paused", () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Start replay but don't pause
      act(() => result.current.startPlaywrightReplay(validCode));

      act(() => result.current.resumePlaywrightReplay());

      // Should have been called once for start, but not for resume
      expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenCalledTimes(1);
    });

    test("should do nothing when iframe ref is null", () => {
      const nullRef = { current: null };
      const { result } = renderHook(() => usePlaywrightReplay(nullRef));

      act(() => result.current.resumePlaywrightReplay());

      expect(result.current.playwrightStatus).toBe("idle");
    });

    test("should send resume message when paused", () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Start replay, then pause
      act(() => result.current.startPlaywrightReplay(validCode));
      act(() => result.current.pausePlaywrightReplay());

      // Now resume
      act(() => result.current.resumePlaywrightReplay());

      expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenCalledWith(
        { type: "staktrak-playwright-replay-resume" },
        "*",
      );
      expect(result.current.isPlaywrightPaused).toBe(false);
      expect(result.current.playwrightStatus).toBe("playing");
    });

    test("should handle postMessage errors", () => {
      const errorRef = {
        current: {
          contentWindow: {
            postMessage: vi.fn(),
          },
        },
      };
      const { result } = renderHook(() => usePlaywrightReplay(errorRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Start and pause
      act(() => result.current.startPlaywrightReplay(validCode));
      act(() => result.current.pausePlaywrightReplay());

      // Make postMessage throw on resume
      errorRef.current.contentWindow.postMessage.mockImplementation(() => {
        throw new Error("PostMessage failed");
      });

      act(() => result.current.resumePlaywrightReplay());

      expect(consoleErrorSpy).toHaveBeenCalledWith("Error resuming Playwright replay:", expect.any(Error));
    });
  });

  describe("stopPlaywrightReplay", () => {
    test("should do nothing when not replaying", () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      act(() => result.current.stopPlaywrightReplay());

      expect(mockIframeRef.current.contentWindow.postMessage).not.toHaveBeenCalled();
    });

    test("should do nothing when iframe ref is null", () => {
      const nullRef = { current: null };
      const { result } = renderHook(() => usePlaywrightReplay(nullRef));

      act(() => result.current.stopPlaywrightReplay());

      expect(result.current.playwrightStatus).toBe("idle");
    });

    test("should send stop message and reset all state", () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Start replay
      act(() => result.current.startPlaywrightReplay(validCode));

      // Simulate progress
      act(() => {
        TestUtils.simulateMessageEvent({
          type: "staktrak-playwright-replay-progress",
          current: 5,
          total: 10,
          action: "clicking button",
        });
      });

      // Stop replay
      act(() => result.current.stopPlaywrightReplay());

      expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenCalledWith(
        { type: "staktrak-playwright-replay-stop" },
        "*",
      );

      // Verify complete state reset
      expect(result.current.isPlaywrightReplaying).toBe(false);
      expect(result.current.isPlaywrightPaused).toBe(false);
      expect(result.current.playwrightStatus).toBe("idle");
      expect(result.current.currentAction).toBeNull();
      expect(result.current.playwrightProgress).toEqual({ current: 0, total: 0 });
    });

    test('should remove "playwright-replaying" class from iframe-container', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      act(() => result.current.startPlaywrightReplay(validCode));
      act(() => result.current.stopPlaywrightReplay());

      const container = querySelectors.get(".iframe-container");
      expect(container?.classList.remove).toHaveBeenCalledWith("playwright-replaying");
    });

    test("should handle postMessage errors", () => {
      const errorRef = {
        current: {
          contentWindow: {
            postMessage: vi.fn(),
          },
        },
      };
      const { result } = renderHook(() => usePlaywrightReplay(errorRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Start replay
      act(() => result.current.startPlaywrightReplay(validCode));

      // Make postMessage throw on stop
      errorRef.current.contentWindow.postMessage.mockImplementation(() => {
        throw new Error("PostMessage failed");
      });

      act(() => result.current.stopPlaywrightReplay());

      expect(consoleErrorSpy).toHaveBeenCalledWith("Error stopping Playwright replay:", expect.any(Error));
    });
  });

  describe("Message Handler - handleMessage", () => {
    describe("staktrak-playwright-replay-preview-ready", () => {
      test("should set previewActions when ready", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        const mockActions = [
          { type: "goto", url: "https://example.com" },
          { type: "click", selector: ".button" },
        ];

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-preview-ready",
            actions: mockActions,
          });
        });

        await waitFor(() => {
          expect(result.current.previewActions).toEqual(mockActions);
        });
      });

      test("should default to empty array if actions not provided", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-preview-ready",
          });
        });

        await waitFor(() => {
          expect(result.current.previewActions).toEqual([]);
        });
      });
    });

    describe("staktrak-playwright-replay-preview-error", () => {
      test("should clear previewActions on error", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Set some preview actions first
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-preview-ready",
            actions: [{ type: "click" }],
          });
        });

        expect(result.current.previewActions).toHaveLength(1);

        // Trigger error
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-preview-error",
            error: "Parse failed",
          });
        });

        await waitFor(() => {
          expect(result.current.previewActions).toEqual([]);
          expect(consoleErrorSpy).toHaveBeenCalledWith("Playwright preview error:", "Parse failed");
        });
      });

      test("should not affect replay state", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-preview-error",
            error: "Parse failed",
          });
        });

        await waitFor(() => {
          expect(result.current.isPlaywrightReplaying).toBe(false);
          expect(result.current.playwrightStatus).toBe("idle");
        });
      });
    });

    describe("staktrak-playwright-replay-started", () => {
      test("should update progress with total actions", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-started",
            totalActions: 15,
          });
        });

        await waitFor(() => {
          expect(result.current.playwrightProgress).toEqual({ current: 0, total: 15 });
        });
      });

      test("should default to 0 total actions if not provided", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-started",
          });
        });

        await waitFor(() => {
          expect(result.current.playwrightProgress).toEqual({ current: 0, total: 0 });
        });
      });
    });

    describe("staktrak-playwright-replay-progress", () => {
      test("should update progress and current action", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-progress",
            current: 7,
            total: 15,
            action: "clicking submit button",
          });
        });

        await waitFor(() => {
          expect(result.current.playwrightProgress).toEqual({ current: 7, total: 15 });
          expect(result.current.currentAction).toBe("clicking submit button");
        });
      });
    });

    describe("staktrak-playwright-replay-completed", () => {
      test("should set status to completed and reset state", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Start replay first
        const validCode = TestDataFactories.createValidPlaywrightTest();
        act(() => result.current.startPlaywrightReplay(validCode));

        // Send completed message
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-completed",
          });
        });

        await waitFor(() => {
          expect(result.current.isPlaywrightReplaying).toBe(false);
          expect(result.current.isPlaywrightPaused).toBe(false);
          expect(result.current.playwrightStatus).toBe("completed");
          expect(result.current.currentAction).toBeNull();
        });
      });

      test('should remove "playwright-replaying" class on completion', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        const validCode = TestDataFactories.createValidPlaywrightTest();
        act(() => result.current.startPlaywrightReplay(validCode));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-completed",
          });
        });

        await waitFor(() => {
          const container = querySelectors.get(".iframe-container");
          expect(container?.classList.remove).toHaveBeenCalledWith("playwright-replaying");
        });
      });
    });

    describe("staktrak-playwright-replay-error", () => {
      test("should accumulate errors without stopping replay", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-error",
            error: "Element not found",
            actionIndex: 3,
            action: "click button",
          });
        });

        await waitFor(() => {
          expect(result.current.replayErrors).toHaveLength(1);
          expect(result.current.replayErrors[0]).toMatchObject({
            message: "Element not found",
            actionIndex: 3,
            action: "click button",
            timestamp: expect.any(String),
          });
        });
      });

      test("should log error to console", async () => {
        renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-error",
            error: "Timeout waiting for element",
          });
        });

        await waitFor(() => {
          expect(consoleWarnSpy).toHaveBeenCalledWith("Playwright replay error:", "Timeout waiting for element");
        });
      });

      test('should use "Unknown error" as default message', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-error",
            actionIndex: 5,
            action: "fill input",
          });
        });

        await waitFor(() => {
          expect(result.current.replayErrors[0].message).toBe("Unknown error");
        });
      });

      test("should accumulate multiple errors", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-error",
            error: "Error 1",
            actionIndex: 1,
            action: "action 1",
          });
        });

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-error",
            error: "Error 2",
            actionIndex: 2,
            action: "action 2",
          });
        });

        await waitFor(() => {
          expect(result.current.replayErrors).toHaveLength(2);
          expect(result.current.replayErrors[0].message).toBe("Error 1");
          expect(result.current.replayErrors[1].message).toBe("Error 2");
        });
      });
    });

    describe("staktrak-playwright-replay-paused", () => {
      test("should update pause state and status", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-paused",
          });
        });

        await waitFor(() => {
          expect(result.current.isPlaywrightPaused).toBe(true);
          expect(result.current.playwrightStatus).toBe("paused");
        });
      });
    });

    describe("staktrak-playwright-replay-resumed", () => {
      test("should update pause state and status", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Pause first
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-paused",
          });
        });

        // Then resume
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-resumed",
          });
        });

        await waitFor(() => {
          expect(result.current.isPlaywrightPaused).toBe(false);
          expect(result.current.playwrightStatus).toBe("playing");
        });
      });
    });

    describe("staktrak-playwright-replay-stopped", () => {
      test("should reset all state and status", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Setup some state first
        const validCode = TestDataFactories.createValidPlaywrightTest();
        act(() => result.current.startPlaywrightReplay(validCode));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-progress",
            current: 8,
            total: 20,
            action: "typing text",
          });
        });

        // Send stopped message
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-stopped",
          });
        });

        await waitFor(() => {
          expect(result.current.isPlaywrightReplaying).toBe(false);
          expect(result.current.isPlaywrightPaused).toBe(false);
          expect(result.current.playwrightStatus).toBe("idle");
          expect(result.current.currentAction).toBeNull();
          expect(result.current.playwrightProgress).toEqual({ current: 0, total: 0 });
        });
      });

      test('should remove "playwright-replaying" class', async () => {
        renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-stopped",
          });
        });

        await waitFor(() => {
          const container = querySelectors.get(".iframe-container");
          expect(container?.classList.remove).toHaveBeenCalledWith("playwright-replaying");
        });
      });
    });

    describe("Unknown Message Types", () => {
      test("should ignore messages with no type", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        const event = new MessageEvent("message", { data: {} });
        act(() => {
          window.dispatchEvent(event);
        });

        TestUtils.expectInitialState(result);
      });

      test("should ignore messages with unrecognized type", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "unknown-message-type",
            data: "some data",
          });
        });

        TestUtils.expectInitialState(result);
      });

      test("should ignore null data", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        const event = new MessageEvent("message", { data: null });
        act(() => {
          window.dispatchEvent(event);
        });

        TestUtils.expectInitialState(result);
      });
    });
  });

  describe("State Transitions", () => {
    test("should transition through complete replay lifecycle", async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Initial state
      TestUtils.expectInitialState(result);

      // Start
      act(() => result.current.startPlaywrightReplay(validCode));
      expect(result.current.playwrightStatus).toBe("playing");
      expect(result.current.isPlaywrightReplaying).toBe(true);

      // Progress
      act(() => {
        TestUtils.simulateMessageEvent({
          type: "staktrak-playwright-replay-progress",
          current: 3,
          total: 10,
          action: "clicking button",
        });
      });
      await waitFor(() => {
        expect(result.current.playwrightProgress.current).toBe(3);
      });

      // Pause
      act(() => result.current.pausePlaywrightReplay());
      expect(result.current.playwrightStatus).toBe("paused");
      expect(result.current.isPlaywrightPaused).toBe(true);

      // Resume
      act(() => result.current.resumePlaywrightReplay());
      expect(result.current.playwrightStatus).toBe("playing");
      expect(result.current.isPlaywrightPaused).toBe(false);

      // Complete
      act(() => {
        TestUtils.simulateMessageEvent({
          type: "staktrak-playwright-replay-completed",
        });
      });
      await waitFor(() => {
        expect(result.current.playwrightStatus).toBe("completed");
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });
    });

    test("should transition from playing to stopped", async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      act(() => result.current.startPlaywrightReplay(validCode));
      expect(result.current.playwrightStatus).toBe("playing");

      act(() => result.current.stopPlaywrightReplay());
      expect(result.current.playwrightStatus).toBe("idle");
      expect(result.current.isPlaywrightReplaying).toBe(false);
    });

    test("should handle error during replay without stopping", async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      act(() => result.current.startPlaywrightReplay(validCode));

      act(() => {
        TestUtils.simulateMessageEvent({
          type: "staktrak-playwright-replay-error",
          error: "Element not found",
          actionIndex: 2,
          action: "click",
        });
      });

      await waitFor(() => {
        expect(result.current.replayErrors).toHaveLength(1);
        // Replay should still be running
        expect(result.current.isPlaywrightReplaying).toBe(true);
        expect(result.current.playwrightStatus).toBe("playing");
      });
    });
  });

  describe("Cleanup", () => {
    test("should remove message listener on unmount", () => {
      const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
      const { unmount } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });

    test("should handle messages after unmount gracefully", () => {
      const { unmount } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      unmount();

      // This should not throw
      expect(() => {
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-started",
            totalActions: 5,
          });
        });
      }).not.toThrow();
    });
  });

  describe("Edge Cases", () => {
    test("should handle multiple start calls", () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      act(() => result.current.startPlaywrightReplay(validCode));
      const firstCallCount = mockIframeRef.current.contentWindow.postMessage.mock.calls.length;

      act(() => result.current.startPlaywrightReplay(validCode));
      const secondCallCount = mockIframeRef.current.contentWindow.postMessage.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount + 1);
      expect(result.current.isPlaywrightReplaying).toBe(true);
    });

    test("should handle pause when already paused", () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      act(() => result.current.startPlaywrightReplay(validCode));
      act(() => result.current.pausePlaywrightReplay());

      const callCount = mockIframeRef.current.contentWindow.postMessage.mock.calls.length;

      act(() => result.current.pausePlaywrightReplay());

      // Should still send the message
      expect(mockIframeRef.current.contentWindow.postMessage.mock.calls.length).toBe(callCount + 1);
    });

    test("should handle very long test code", () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const longTestCode = `test('very long test', async ({ page }) => {
        ${'await page.click("button");\n'.repeat(1000)}
      });`;

      let success: boolean;
      act(() => {
        success = result.current.startPlaywrightReplay(longTestCode);
      });

      expect(success!).toBe(true);
      expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenCalledWith(
        {
          type: "staktrak-playwright-replay-start",
          testCode: longTestCode,
        },
        "*",
      );
    });

    test("should handle rapid state changes", async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      act(() => result.current.startPlaywrightReplay(validCode));
      act(() => result.current.pausePlaywrightReplay());
      act(() => result.current.resumePlaywrightReplay());
      act(() => result.current.pausePlaywrightReplay());
      act(() => result.current.resumePlaywrightReplay());

      expect(result.current.isPlaywrightReplaying).toBe(true);
      expect(result.current.isPlaywrightPaused).toBe(false);
      expect(result.current.playwrightStatus).toBe("playing");
    });

    test("should handle message events with extra properties", async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      act(() => {
        TestUtils.simulateMessageEvent({
          type: "staktrak-playwright-replay-progress",
          current: 5,
          total: 10,
          action: "clicking",
          extraProperty: "should be ignored",
          anotherExtra: { nested: "object" },
        });
      });

      await waitFor(() => {
        expect(result.current.playwrightProgress).toEqual({ current: 5, total: 10 });
        expect(result.current.currentAction).toBe("clicking");
      });
    });
  });

  describe("Screenshot Functionality", () => {
    describe("staktrak-playwright-screenshot-captured", () => {
      test("should add screenshot to replayScreenshots state", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-captured",
            id: "screenshot-1",
            actionIndex: 0,
            screenshot: "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
            timestamp: 1234567890,
            url: "https://example.com/page1",
          });
        });

        await waitFor(() => {
          expect(result.current.replayScreenshots).toHaveLength(1);
          expect(result.current.replayScreenshots[0]).toEqual({
            id: "screenshot-1",
            actionIndex: 0,
            dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
            timestamp: 1234567890,
            url: "https://example.com/page1",
          });
        });
      });

      test("should map screenshot field to dataUrl", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        const dataUrl = "data:image/jpeg;base64,testimage123";
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-captured",
            id: "test-id",
            actionIndex: 2,
            screenshot: dataUrl,
            timestamp: Date.now(),
            url: "https://example.com",
          });
        });

        await waitFor(() => {
          expect(result.current.replayScreenshots[0].dataUrl).toBe(dataUrl);
        });
      });

      test("should accumulate multiple screenshots in order", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        const screenshots = [
          {
            id: "screenshot-1",
            actionIndex: 0,
            screenshot: "data:image/jpeg;base64,first",
            timestamp: 1000,
            url: "https://example.com/page1",
          },
          {
            id: "screenshot-2",
            actionIndex: 1,
            screenshot: "data:image/jpeg;base64,second",
            timestamp: 2000,
            url: "https://example.com/page2",
          },
          {
            id: "screenshot-3",
            actionIndex: 2,
            screenshot: "data:image/jpeg;base64,third",
            timestamp: 3000,
            url: "https://example.com/page3",
          },
        ];

        act(() => {
          screenshots.forEach((screenshot) => {
            TestUtils.simulateMessageEvent({
              type: "staktrak-playwright-screenshot-captured",
              ...screenshot,
            });
          });
        });

        await waitFor(() => {
          expect(result.current.replayScreenshots).toHaveLength(3);
          expect(result.current.replayScreenshots[0].id).toBe("screenshot-1");
          expect(result.current.replayScreenshots[1].id).toBe("screenshot-2");
          expect(result.current.replayScreenshots[2].id).toBe("screenshot-3");
        });
      });

      test("should maintain screenshots during replay progress", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        act(() => result.current.startPlaywrightReplay(validCode));

        // Add screenshot
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-captured",
            id: "screenshot-1",
            actionIndex: 0,
            screenshot: "data:image/jpeg;base64,test",
            timestamp: Date.now(),
            url: "https://example.com",
          });
        });

        // Trigger progress event
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-progress",
            current: 1,
            total: 5,
            action: "click",
          });
        });

        await waitFor(() => {
          expect(result.current.replayScreenshots).toHaveLength(1);
          expect(result.current.playwrightProgress.current).toBe(1);
        });
      });

      test("should preserve screenshots when replay completes", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        act(() => result.current.startPlaywrightReplay(validCode));

        // Add screenshots
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-captured",
            id: "screenshot-1",
            actionIndex: 0,
            screenshot: "data:image/jpeg;base64,test1",
            timestamp: Date.now(),
            url: "https://example.com/1",
          });
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-captured",
            id: "screenshot-2",
            actionIndex: 1,
            screenshot: "data:image/jpeg;base64,test2",
            timestamp: Date.now(),
            url: "https://example.com/2",
          });
        });

        expect(result.current.replayScreenshots).toHaveLength(2);

        // Complete replay
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-completed",
          });
        });

        await waitFor(() => {
          expect(result.current.replayScreenshots).toHaveLength(2);
          expect(result.current.isPlaywrightReplaying).toBe(false);
          expect(result.current.playwrightStatus).toBe("completed");
        });
      });
    });

    describe("staktrak-playwright-screenshot-error", () => {
      test("should call onScreenshotError callback when provided", async () => {
        const onScreenshotError = vi.fn();
        renderHook(() => usePlaywrightReplay(mockIframeRef, null, null, onScreenshotError));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-error",
            actionIndex: 5,
            error: "Failed to capture screenshot",
          });
        });

        await waitFor(() => {
          expect(onScreenshotError).toHaveBeenCalledWith("Screenshot capture failed for action 5");
          expect(onScreenshotError).toHaveBeenCalledTimes(1);
        });
      });

      test("should log warning to console when screenshot fails", async () => {
        renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-error",
            actionIndex: 3,
            error: "Screenshot timeout",
          });
        });

        await waitFor(() => {
          expect(consoleWarnSpy).toHaveBeenCalledWith("Screenshot failed for action 3:", "Screenshot timeout");
        });
      });

      test("should not call onScreenshotError if callback not provided", async () => {
        renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-error",
            actionIndex: 1,
            error: "Error",
          });
        });

        await waitFor(() => {
          expect(consoleWarnSpy).toHaveBeenCalled();
        });
      });

      test("should not stop replay when screenshot error occurs", async () => {
        const onScreenshotError = vi.fn();
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef, null, null, onScreenshotError));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        act(() => result.current.startPlaywrightReplay(validCode));

        expect(result.current.isPlaywrightReplaying).toBe(true);

        // Trigger screenshot error
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-error",
            actionIndex: 1,
            error: "Screenshot failed",
          });
        });

        await waitFor(() => {
          expect(result.current.isPlaywrightReplaying).toBe(true);
          expect(onScreenshotError).toHaveBeenCalled();
        });
      });

      test("should handle multiple screenshot errors", async () => {
        const onScreenshotError = vi.fn();
        renderHook(() => usePlaywrightReplay(mockIframeRef, null, null, onScreenshotError));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-error",
            actionIndex: 1,
            error: "Error 1",
          });
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-error",
            actionIndex: 2,
            error: "Error 2",
          });
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-error",
            actionIndex: 3,
            error: "Error 3",
          });
        });

        await waitFor(() => {
          expect(onScreenshotError).toHaveBeenCalledTimes(3);
          expect(onScreenshotError).toHaveBeenNthCalledWith(1, "Screenshot capture failed for action 1");
          expect(onScreenshotError).toHaveBeenNthCalledWith(2, "Screenshot capture failed for action 2");
          expect(onScreenshotError).toHaveBeenNthCalledWith(3, "Screenshot capture failed for action 3");
        });
      });
    });

    describe("Screenshot State Lifecycle", () => {
      test("should initialize with empty screenshots array", () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        expect(result.current.replayScreenshots).toEqual([]);
        expect(result.current.replayActions).toEqual([]);
      });

      test("should clear screenshots when starting new replay", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Add screenshots
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-captured",
            id: "screenshot-1",
            actionIndex: 0,
            screenshot: "data:image/jpeg;base64,test",
            timestamp: Date.now(),
            url: "https://example.com",
          });
        });

        expect(result.current.replayScreenshots).toHaveLength(1);

        // Start new replay
        const validCode = TestDataFactories.createValidPlaywrightTest();
        act(() => result.current.startPlaywrightReplay(validCode));

        await waitFor(() => {
          expect(result.current.replayScreenshots).toEqual([]);
        });
      });

      test("should maintain screenshots after stopping replay", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        act(() => result.current.startPlaywrightReplay(validCode));

        // Add screenshot
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-captured",
            id: "screenshot-1",
            actionIndex: 0,
            screenshot: "data:image/jpeg;base64,test",
            timestamp: Date.now(),
            url: "https://example.com",
          });
        });

        // Stop replay
        act(() => result.current.stopPlaywrightReplay());

        await waitFor(() => {
          expect(result.current.replayScreenshots).toHaveLength(1);
          expect(result.current.isPlaywrightReplaying).toBe(false);
        });
      });

      test("should clear actions when starting new replay", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Add actions via started message
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-started",
            totalActions: 5,
            actions: [{ type: "click" }, { type: "fill" }],
          });
        });

        expect(result.current.replayActions).toHaveLength(2);

        // Start new replay
        const validCode = TestDataFactories.createValidPlaywrightTest();
        act(() => result.current.startPlaywrightReplay(validCode));

        await waitFor(() => {
          expect(result.current.replayActions).toEqual([]);
        });
      });
    });

    describe("Replay Actions State", () => {
      test("should set replayActions when replay starts", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        const mockActions = [
          { type: "goto", url: "https://example.com" },
          { type: "click", selector: ".button" },
          { type: "fill", selector: "input", value: "test" },
        ];

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-started",
            totalActions: 3,
            actions: mockActions,
          });
        });

        await waitFor(() => {
          expect(result.current.replayActions).toEqual(mockActions);
          expect(result.current.playwrightProgress.total).toBe(3);
        });
      });

      test("should handle empty actions array", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-started",
            totalActions: 0,
            actions: [],
          });
        });

        await waitFor(() => {
          expect(result.current.replayActions).toEqual([]);
        });
      });

      test("should default to empty array if actions not provided", async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-replay-started",
            totalActions: 5,
          });
        });

        await waitFor(() => {
          expect(result.current.replayActions).toEqual([]);
        });
      });
    });

    describe("Screenshot and Error Callback Dependencies", () => {
      test("should re-register listener when onScreenshotError callback changes", async () => {
        const callback1 = vi.fn();
        const callback2 = vi.fn();

        const { rerender } = renderHook(({ callback }) => usePlaywrightReplay(mockIframeRef, null, null, callback), {
          initialProps: { callback: callback1 },
        });

        // Trigger screenshot error with first callback
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-error",
            actionIndex: 1,
            error: "Error 1",
          });
        });

        await waitFor(() => {
          expect(callback1).toHaveBeenCalledWith("Screenshot capture failed for action 1");
        });

        // Change callback
        rerender({ callback: callback2 });

        // Trigger screenshot error with second callback
        act(() => {
          TestUtils.simulateMessageEvent({
            type: "staktrak-playwright-screenshot-error",
            actionIndex: 2,
            error: "Error 2",
          });
        });

        await waitFor(() => {
          expect(callback2).toHaveBeenCalledWith("Screenshot capture failed for action 2");
        });
      });
    });
  });

  describe("Preview and Replay Independence", () => {
    test("should allow replay to succeed even if preview failed", async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Preview fails
      act(() => result.current.previewPlaywrightReplay(validCode));
      act(() => {
        TestUtils.simulateMessageEvent({
          type: "staktrak-playwright-replay-preview-error",
          error: "Parse error",
        });
      });

      await waitFor(() => {
        expect(result.current.previewActions).toEqual([]);
      });

      // Replay should still work
      act(() => result.current.startPlaywrightReplay(validCode));

      expect(result.current.isPlaywrightReplaying).toBe(true);
      expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenLastCalledWith(
        {
          type: "staktrak-playwright-replay-start",
          testCode: validCode,
        },
        "*",
      );
    });

    test("should use separate state for preview and replay actions", async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      const previewActions = [
        { type: "goto", url: "https://preview.com" },
        { type: "click", selector: ".preview-button" },
      ];

      const replayActions = [
        { type: "goto", url: "https://replay.com" },
        { type: "click", selector: ".replay-button" },
      ];

      // Set preview actions
      act(() => {
        TestUtils.simulateMessageEvent({
          type: "staktrak-playwright-replay-preview-ready",
          actions: previewActions,
        });
      });

      await waitFor(() => {
        expect(result.current.previewActions).toEqual(previewActions);
      });

      // Start replay with different actions
      act(() => {
        TestUtils.simulateMessageEvent({
          type: "staktrak-playwright-replay-started",
          actions: replayActions,
          totalActions: 2,
        });
      });

      await waitFor(() => {
        expect(result.current.replayActions).toEqual(replayActions);
        expect(result.current.previewActions).toEqual(previewActions); // Preview still intact
      });
    });

    test("should not affect replay state when preview is triggered", () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Start replay first
      act(() => result.current.startPlaywrightReplay(validCode));

      expect(result.current.isPlaywrightReplaying).toBe(true);
      expect(result.current.playwrightStatus).toBe("playing");

      // Preview should not change replay state
      act(() => result.current.previewPlaywrightReplay(validCode));

      expect(result.current.isPlaywrightReplaying).toBe(true);
      expect(result.current.playwrightStatus).toBe("playing");
    });
  });
});
