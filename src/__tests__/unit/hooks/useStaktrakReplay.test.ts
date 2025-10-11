import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { usePlaywrightReplay } from '@/hooks/useStaktrakReplay';

describe('usePlaywrightReplay', () => {
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
      empty: () => '',
      nonString: () => null as any,
    },

    createMessageEvent: (type: string, data: any = {}) =>
      new MessageEvent('message', {
        data: { type, ...data },
      }),
  };

  // Test utilities
  const TestUtils = {
    simulateMessageEvent: (eventData: any) => {
      const event = TestDataFactories.createMessageEvent(eventData.type, eventData);
      window.dispatchEvent(event);
    },

    expectInitialState: (result: any) => {
      expect(result.current.isPlaywrightReplaying).toBe(false);
      expect(result.current.isPlaywrightPaused).toBe(false);
      expect(result.current.playwrightStatus).toBe('idle');
      expect(result.current.playwrightProgress).toEqual({ current: 0, total: 0 });
      expect(result.current.currentAction).toBeNull();
      expect(result.current.replayErrors).toEqual([]);
    },
  };

  let mockIframeRef: any;
  let consoleErrorSpy: any;
  let consoleWarnSpy: any;
  let querySelectors: Map<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock console methods
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Mock DOM querySelector
    querySelectors = new Map();
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
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

  describe('Initial State', () => {
    test('should initialize with correct default state', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      TestUtils.expectInitialState(result);
    });

    test('should return all expected control functions', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      expect(result.current.startPlaywrightReplay).toBeInstanceOf(Function);
      expect(result.current.pausePlaywrightReplay).toBeInstanceOf(Function);
      expect(result.current.resumePlaywrightReplay).toBeInstanceOf(Function);
      expect(result.current.stopPlaywrightReplay).toBeInstanceOf(Function);
    });
  });

  describe('startPlaywrightReplay', () => {
    describe('Validation', () => {
      test('should return false when iframe ref is null', () => {
        const nullRef = { current: null };
        const { result } = renderHook(() => usePlaywrightReplay(nullRef));

        let success: boolean;
        act(() => {
          success = result.current.startPlaywrightReplay('test code');
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });

      test('should return false when iframe has no contentWindow', () => {
        const invalidRef = { current: {} as any };
        const { result } = renderHook(() => usePlaywrightReplay(invalidRef));

        let success: boolean;
        act(() => {
          success = result.current.startPlaywrightReplay('test code');
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });

      test('should return false when testCode is empty string', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        let success: boolean;
        act(() => {
          success = result.current.startPlaywrightReplay('');
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });

      test('should return false when testCode is not a string', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        let success: boolean;
        act(() => {
          success = result.current.startPlaywrightReplay(null as any);
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

    describe('Successful Start', () => {
      test('should start replay with valid test code', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        let success: boolean;
        act(() => {
          success = result.current.startPlaywrightReplay(validCode);
        });

        expect(success!).toBe(true);
        expect(result.current.isPlaywrightReplaying).toBe(true);
        expect(result.current.isPlaywrightPaused).toBe(false);
        expect(result.current.playwrightStatus).toBe('playing');
      });

      test('should send postMessage to iframe with correct payload', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        act(() => result.current.startPlaywrightReplay(validCode));

        expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenCalledWith(
          {
            type: 'staktrak-playwright-replay-start',
            testCode: validCode,
          },
          '*'
        );
      });

      test('should reset errors and current action on start', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Simulate existing errors and action
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-error',
            error: 'Previous error',
            actionIndex: 0,
            action: 'click',
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

        const container = querySelectors.get('.iframe-container');
        expect(container?.classList.add).toHaveBeenCalledWith('playwright-replaying');
      });
    });

    describe('Error Handling', () => {
      test('should handle postMessage errors gracefully', () => {
        const errorRef = {
          current: {
            contentWindow: {
              postMessage: vi.fn().mockImplementation(() => {
                throw new Error('PostMessage failed');
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
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error starting Playwright replay:',
          expect.any(Error)
        );
      });

      test('should remove "playwright-replaying" class on error', () => {
        const errorRef = {
          current: {
            contentWindow: {
              postMessage: vi.fn().mockImplementation(() => {
                throw new Error('PostMessage failed');
              }),
            },
          },
        };
        const { result } = renderHook(() => usePlaywrightReplay(errorRef));
        const validCode = TestDataFactories.createValidPlaywrightTest();

        act(() => result.current.startPlaywrightReplay(validCode));

        const container = querySelectors.get('.iframe-container');
        expect(container?.classList.remove).toHaveBeenCalledWith('playwright-replaying');
      });
    });
  });

  describe('pausePlaywrightReplay', () => {
    test('should do nothing when not replaying', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      act(() => result.current.pausePlaywrightReplay());

      expect(mockIframeRef.current.contentWindow.postMessage).not.toHaveBeenCalled();
      expect(result.current.isPlaywrightPaused).toBe(false);
    });

    test('should do nothing when iframe ref is null', () => {
      const nullRef = { current: null };
      const { result } = renderHook(() => usePlaywrightReplay(nullRef));

      act(() => result.current.pausePlaywrightReplay());

      expect(result.current.isPlaywrightPaused).toBe(false);
    });

    test('should send pause message when replaying', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Start replay first
      act(() => result.current.startPlaywrightReplay(validCode));

      // Then pause
      act(() => result.current.pausePlaywrightReplay());

      expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenCalledWith(
        { type: 'staktrak-playwright-replay-pause' },
        '*'
      );
      expect(result.current.isPlaywrightPaused).toBe(true);
      expect(result.current.playwrightStatus).toBe('paused');
    });

    test('should handle postMessage errors', () => {
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
        throw new Error('PostMessage failed');
      });

      act(() => result.current.pausePlaywrightReplay());

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error pausing Playwright replay:',
        expect.any(Error)
      );
    });
  });

  describe('resumePlaywrightReplay', () => {
    test('should do nothing when not replaying', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      act(() => result.current.resumePlaywrightReplay());

      expect(mockIframeRef.current.contentWindow.postMessage).not.toHaveBeenCalled();
    });

    test('should do nothing when not paused', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Start replay but don't pause
      act(() => result.current.startPlaywrightReplay(validCode));

      act(() => result.current.resumePlaywrightReplay());

      // Should have been called once for start, but not for resume
      expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenCalledTimes(1);
    });

    test('should do nothing when iframe ref is null', () => {
      const nullRef = { current: null };
      const { result } = renderHook(() => usePlaywrightReplay(nullRef));

      act(() => result.current.resumePlaywrightReplay());

      expect(result.current.playwrightStatus).toBe('idle');
    });

    test('should send resume message when paused', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Start replay, then pause
      act(() => result.current.startPlaywrightReplay(validCode));
      act(() => result.current.pausePlaywrightReplay());

      // Now resume
      act(() => result.current.resumePlaywrightReplay());

      expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenCalledWith(
        { type: 'staktrak-playwright-replay-resume' },
        '*'
      );
      expect(result.current.isPlaywrightPaused).toBe(false);
      expect(result.current.playwrightStatus).toBe('playing');
    });

    test('should handle postMessage errors', () => {
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
        throw new Error('PostMessage failed');
      });

      act(() => result.current.resumePlaywrightReplay());

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error resuming Playwright replay:',
        expect.any(Error)
      );
    });
  });

  describe('stopPlaywrightReplay', () => {
    test('should do nothing when not replaying', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      act(() => result.current.stopPlaywrightReplay());

      expect(mockIframeRef.current.contentWindow.postMessage).not.toHaveBeenCalled();
    });

    test('should do nothing when iframe ref is null', () => {
      const nullRef = { current: null };
      const { result } = renderHook(() => usePlaywrightReplay(nullRef));

      act(() => result.current.stopPlaywrightReplay());

      expect(result.current.playwrightStatus).toBe('idle');
    });

    test('should send stop message and reset all state', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Start replay
      act(() => result.current.startPlaywrightReplay(validCode));

      // Simulate progress
      act(() => {
        TestUtils.simulateMessageEvent({
          type: 'staktrak-playwright-replay-progress',
          current: 5,
          total: 10,
          action: 'clicking button',
        });
      });

      // Stop replay
      act(() => result.current.stopPlaywrightReplay());

      expect(mockIframeRef.current.contentWindow.postMessage).toHaveBeenCalledWith(
        { type: 'staktrak-playwright-replay-stop' },
        '*'
      );

      // Verify complete state reset
      expect(result.current.isPlaywrightReplaying).toBe(false);
      expect(result.current.isPlaywrightPaused).toBe(false);
      expect(result.current.playwrightStatus).toBe('idle');
      expect(result.current.currentAction).toBeNull();
      expect(result.current.playwrightProgress).toEqual({ current: 0, total: 0 });
    });

    test('should remove "playwright-replaying" class from iframe-container', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      act(() => result.current.startPlaywrightReplay(validCode));
      act(() => result.current.stopPlaywrightReplay());

      const container = querySelectors.get('.iframe-container');
      expect(container?.classList.remove).toHaveBeenCalledWith('playwright-replaying');
    });

    test('should handle postMessage errors', () => {
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
        throw new Error('PostMessage failed');
      });

      act(() => result.current.stopPlaywrightReplay());

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error stopping Playwright replay:',
        expect.any(Error)
      );
    });
  });

  describe('Message Handler - handleMessage', () => {
    describe('staktrak-playwright-replay-started', () => {
      test('should update progress with total actions', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-started',
            totalActions: 15,
          });
        });

        await waitFor(() => {
          expect(result.current.playwrightProgress).toEqual({ current: 0, total: 15 });
        });
      });

      test('should default to 0 total actions if not provided', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-started',
          });
        });

        await waitFor(() => {
          expect(result.current.playwrightProgress).toEqual({ current: 0, total: 0 });
        });
      });
    });

    describe('staktrak-playwright-replay-progress', () => {
      test('should update progress and current action', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-progress',
            current: 7,
            total: 15,
            action: 'clicking submit button',
          });
        });

        await waitFor(() => {
          expect(result.current.playwrightProgress).toEqual({ current: 7, total: 15 });
          expect(result.current.currentAction).toBe('clicking submit button');
        });
      });
    });

    describe('staktrak-playwright-replay-completed', () => {
      test('should set status to completed and reset state', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Start replay first
        const validCode = TestDataFactories.createValidPlaywrightTest();
        act(() => result.current.startPlaywrightReplay(validCode));

        // Send completed message
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-completed',
          });
        });

        await waitFor(() => {
          expect(result.current.isPlaywrightReplaying).toBe(false);
          expect(result.current.isPlaywrightPaused).toBe(false);
          expect(result.current.playwrightStatus).toBe('completed');
          expect(result.current.currentAction).toBeNull();
        });
      });

      test('should remove "playwright-replaying" class on completion', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        const validCode = TestDataFactories.createValidPlaywrightTest();
        act(() => result.current.startPlaywrightReplay(validCode));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-completed',
          });
        });

        await waitFor(() => {
          const container = querySelectors.get('.iframe-container');
          expect(container?.classList.remove).toHaveBeenCalledWith('playwright-replaying');
        });
      });
    });

    describe('staktrak-playwright-replay-error', () => {
      test('should accumulate errors without stopping replay', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-error',
            error: 'Element not found',
            actionIndex: 3,
            action: 'click button',
          });
        });

        await waitFor(() => {
          expect(result.current.replayErrors).toHaveLength(1);
          expect(result.current.replayErrors[0]).toMatchObject({
            message: 'Element not found',
            actionIndex: 3,
            action: 'click button',
            timestamp: expect.any(String),
          });
        });
      });

      test('should log error to console', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-error',
            error: 'Timeout waiting for element',
          });
        });

        await waitFor(() => {
          expect(consoleWarnSpy).toHaveBeenCalledWith(
            'Playwright replay error:',
            'Timeout waiting for element'
          );
        });
      });

      test('should use "Unknown error" as default message', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-error',
            actionIndex: 5,
            action: 'fill input',
          });
        });

        await waitFor(() => {
          expect(result.current.replayErrors[0].message).toBe('Unknown error');
        });
      });

      test('should accumulate multiple errors', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-error',
            error: 'Error 1',
            actionIndex: 1,
            action: 'action 1',
          });
        });

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-error',
            error: 'Error 2',
            actionIndex: 2,
            action: 'action 2',
          });
        });

        await waitFor(() => {
          expect(result.current.replayErrors).toHaveLength(2);
          expect(result.current.replayErrors[0].message).toBe('Error 1');
          expect(result.current.replayErrors[1].message).toBe('Error 2');
        });
      });
    });

    describe('staktrak-playwright-replay-paused', () => {
      test('should update pause state and status', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-paused',
          });
        });

        await waitFor(() => {
          expect(result.current.isPlaywrightPaused).toBe(true);
          expect(result.current.playwrightStatus).toBe('paused');
        });
      });
    });

    describe('staktrak-playwright-replay-resumed', () => {
      test('should update pause state and status', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Pause first
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-paused',
          });
        });

        // Then resume
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-resumed',
          });
        });

        await waitFor(() => {
          expect(result.current.isPlaywrightPaused).toBe(false);
          expect(result.current.playwrightStatus).toBe('playing');
        });
      });
    });

    describe('staktrak-playwright-replay-stopped', () => {
      test('should reset all state and status', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Setup some state first
        const validCode = TestDataFactories.createValidPlaywrightTest();
        act(() => result.current.startPlaywrightReplay(validCode));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-progress',
            current: 8,
            total: 20,
            action: 'typing text',
          });
        });

        // Send stopped message
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-stopped',
          });
        });

        await waitFor(() => {
          expect(result.current.isPlaywrightReplaying).toBe(false);
          expect(result.current.isPlaywrightPaused).toBe(false);
          expect(result.current.playwrightStatus).toBe('idle');
          expect(result.current.currentAction).toBeNull();
          expect(result.current.playwrightProgress).toEqual({ current: 0, total: 0 });
        });
      });

      test('should remove "playwright-replaying" class', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-stopped',
          });
        });

        await waitFor(() => {
          const container = querySelectors.get('.iframe-container');
          expect(container?.classList.remove).toHaveBeenCalledWith('playwright-replaying');
        });
      });
    });

    describe('Unknown Message Types', () => {
      test('should ignore messages with no type', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        const event = new MessageEvent('message', { data: {} });
        act(() => {
          window.dispatchEvent(event);
        });

        TestUtils.expectInitialState(result);
      });

      test('should ignore messages with unrecognized type', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'unknown-message-type',
            data: 'some data',
          });
        });

        TestUtils.expectInitialState(result);
      });

      test('should ignore null data', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        const event = new MessageEvent('message', { data: null });
        act(() => {
          window.dispatchEvent(event);
        });

        TestUtils.expectInitialState(result);
      });
    });
  });

  describe('State Transitions', () => {
    test('should transition through complete replay lifecycle', async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      // Initial state
      TestUtils.expectInitialState(result);

      // Start
      act(() => result.current.startPlaywrightReplay(validCode));
      expect(result.current.playwrightStatus).toBe('playing');
      expect(result.current.isPlaywrightReplaying).toBe(true);

      // Progress
      act(() => {
        TestUtils.simulateMessageEvent({
          type: 'staktrak-playwright-replay-progress',
          current: 3,
          total: 10,
          action: 'clicking button',
        });
      });
      await waitFor(() => {
        expect(result.current.playwrightProgress.current).toBe(3);
      });

      // Pause
      act(() => result.current.pausePlaywrightReplay());
      expect(result.current.playwrightStatus).toBe('paused');
      expect(result.current.isPlaywrightPaused).toBe(true);

      // Resume
      act(() => result.current.resumePlaywrightReplay());
      expect(result.current.playwrightStatus).toBe('playing');
      expect(result.current.isPlaywrightPaused).toBe(false);

      // Complete
      act(() => {
        TestUtils.simulateMessageEvent({
          type: 'staktrak-playwright-replay-completed',
        });
      });
      await waitFor(() => {
        expect(result.current.playwrightStatus).toBe('completed');
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });
    });

    test('should transition from playing to stopped', async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      act(() => result.current.startPlaywrightReplay(validCode));
      expect(result.current.playwrightStatus).toBe('playing');

      act(() => result.current.stopPlaywrightReplay());
      expect(result.current.playwrightStatus).toBe('idle');
      expect(result.current.isPlaywrightReplaying).toBe(false);
    });

    test('should handle error during replay without stopping', async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      act(() => result.current.startPlaywrightReplay(validCode));

      act(() => {
        TestUtils.simulateMessageEvent({
          type: 'staktrak-playwright-replay-error',
          error: 'Element not found',
          actionIndex: 2,
          action: 'click',
        });
      });

      await waitFor(() => {
        expect(result.current.replayErrors).toHaveLength(1);
        // Replay should still be running
        expect(result.current.isPlaywrightReplaying).toBe(true);
        expect(result.current.playwrightStatus).toBe('playing');
      });
    });
  });

  describe('Cleanup', () => {
    test('should remove message listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      const { unmount } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });

    test('should handle messages after unmount gracefully', () => {
      const { result, unmount } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      unmount();

      // This should not throw
      expect(() => {
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-started',
            totalActions: 5,
          });
        });
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    test('should handle multiple start calls', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      act(() => result.current.startPlaywrightReplay(validCode));
      const firstCallCount = mockIframeRef.current.contentWindow.postMessage.mock.calls.length;

      act(() => result.current.startPlaywrightReplay(validCode));
      const secondCallCount = mockIframeRef.current.contentWindow.postMessage.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount + 1);
      expect(result.current.isPlaywrightReplaying).toBe(true);
    });

    test('should handle pause when already paused', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      act(() => result.current.startPlaywrightReplay(validCode));
      act(() => result.current.pausePlaywrightReplay());

      const callCount = mockIframeRef.current.contentWindow.postMessage.mock.calls.length;

      act(() => result.current.pausePlaywrightReplay());

      // Should still send the message
      expect(mockIframeRef.current.contentWindow.postMessage.mock.calls.length).toBe(
        callCount + 1
      );
    });

    test('should handle very long test code', () => {
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
          type: 'staktrak-playwright-replay-start',
          testCode: longTestCode,
        },
        '*'
      );
    });

    test('should handle rapid state changes', async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const validCode = TestDataFactories.createValidPlaywrightTest();

      act(() => result.current.startPlaywrightReplay(validCode));
      act(() => result.current.pausePlaywrightReplay());
      act(() => result.current.resumePlaywrightReplay());
      act(() => result.current.pausePlaywrightReplay());
      act(() => result.current.resumePlaywrightReplay());

      expect(result.current.isPlaywrightReplaying).toBe(true);
      expect(result.current.isPlaywrightPaused).toBe(false);
      expect(result.current.playwrightStatus).toBe('playing');
    });

    test('should handle message events with extra properties', async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      act(() => {
        TestUtils.simulateMessageEvent({
          type: 'staktrak-playwright-replay-progress',
          current: 5,
          total: 10,
          action: 'clicking',
          extraProperty: 'should be ignored',
          anotherExtra: { nested: 'object' },
        });
      });

      await waitFor(() => {
        expect(result.current.playwrightProgress).toEqual({ current: 5, total: 10 });
        expect(result.current.currentAction).toBe('clicking');
      });
    });
  });
});