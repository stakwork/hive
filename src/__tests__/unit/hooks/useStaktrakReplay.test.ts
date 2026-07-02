import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { usePlaywrightReplay } from '@/hooks/useStaktrakReplay';

describe('usePlaywrightReplay', () => {
  // Test data factories
  const TestDataFactories = {
    // Full iframe ref: mutable `src`, add/removeEventListener spies, and a
    // contentWindow with a postMessage spy. `withContentWindow=false` yields the
    // null-ref case some tests rely on.
    createMockIframeRef: (withContentWindow = true) => ({
      current: withContentWindow
        ? {
            src: 'https://pod.example.com/app',
            contentWindow: {
              postMessage: vi.fn(),
            },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }
        : null,
    }),

    // Variant where `current` exists but has no contentWindow (guard path).
    createMockIframeRefWithoutContentWindow: () => ({
      current: {
        src: 'https://pod.example.com/app',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    }),

    // Realistic structured replay steps (what useStaktrak.getReplaySteps() returns).
    createValidSteps: () => [
      { type: 'click', selector: 'getByTestId:foo' },
      { type: 'input', selector: 'getByRole:textbox', value: 'hello' },
    ],

    createMessageEvent: (type: string, data: Record<string, unknown> = {}) =>
      new MessageEvent('message', {
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
      expect(result.current.playwrightStatus).toBe('idle');
      expect(result.current.playwrightProgress).toEqual({ current: 0, total: 0 });
      expect(result.current.currentAction).toBeNull();
      expect(result.current.replayErrors).toEqual([]);
    },

    // startStructuredReplay defers the iframe postMessage until the reloaded
    // document fires `load` and a 250ms settle timer elapses. This helper drives
    // that whole sequence. Requires vi.useFakeTimers() to be active.
    driveDeferredSend: (ref: { current: { addEventListener: ReturnType<typeof vi.fn> } }) => {
      const loadCall = ref.current.addEventListener.mock.calls.find((c) => c[0] === 'load');
      const loadHandler = loadCall?.[1] as () => void;
      act(() => {
        loadHandler();
      });
      act(() => {
        vi.advanceTimersByTime(250);
      });
      return loadHandler;
    },
  };

  let mockIframeRef: ReturnType<typeof TestDataFactories.createMockIframeRef>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let querySelectors: Map<string, { classList: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; contains: ReturnType<typeof vi.fn> } }>;

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

      expect(result.current.startStructuredReplay).toBeInstanceOf(Function);
      expect(result.current.pausePlaywrightReplay).toBeInstanceOf(Function);
      expect(result.current.resumePlaywrightReplay).toBeInstanceOf(Function);
      expect(result.current.stopPlaywrightReplay).toBeInstanceOf(Function);
    });
  });

  describe('startStructuredReplay', () => {
    describe('Validation', () => {
      test('should return false when iframe ref is null', () => {
        const nullRef = TestDataFactories.createMockIframeRef(false);
        const { result } = renderHook(() => usePlaywrightReplay(nullRef));

        let success: boolean;
        act(() => {
          success = result.current.startStructuredReplay(TestDataFactories.createValidSteps());
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });

      test('should return false when iframe has no contentWindow', () => {
        const noContentWindowRef = TestDataFactories.createMockIframeRefWithoutContentWindow();
        const { result } = renderHook(() => usePlaywrightReplay(noContentWindowRef));

        let success: boolean;
        act(() => {
          success = result.current.startStructuredReplay(TestDataFactories.createValidSteps());
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });

      test('should return false when steps is not an array', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        let success: boolean;
        act(() => {
          success = result.current.startStructuredReplay(null as unknown as unknown[]);
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });

      test('should return false when steps is an empty array', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        let success: boolean;
        act(() => {
          success = result.current.startStructuredReplay([]);
        });

        expect(success!).toBe(false);
        expect(result.current.isPlaywrightReplaying).toBe(false);
      });
    });

    describe('Successful Start', () => {
      test('should start replay and set replaying state', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        let success: boolean;
        act(() => {
          success = result.current.startStructuredReplay(TestDataFactories.createValidSteps());
        });

        expect(success!).toBe(true);
        expect(result.current.isPlaywrightReplaying).toBe(true);
        expect(result.current.isPlaywrightPaused).toBe(false);
        expect(result.current.playwrightStatus).toBe('playing');
      });

      test('should register a one-time load listener and reload the iframe by reassigning src', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Track src reassignment (the cross-origin reload trigger).
        let srcSetCount = 0;
        let srcValue = mockIframeRef.current!.src;
        Object.defineProperty(mockIframeRef.current, 'src', {
          configurable: true,
          get: () => srcValue,
          set: (v) => {
            srcValue = v;
            srcSetCount += 1;
          },
        });

        act(() => {
          result.current.startStructuredReplay(TestDataFactories.createValidSteps());
        });

        expect(mockIframeRef.current!.addEventListener).toHaveBeenCalledWith(
          'load',
          expect.any(Function)
        );
        expect(srcSetCount).toBe(1);
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
        act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

        expect(result.current.replayErrors).toEqual([]);
        expect(result.current.currentAction).toBeNull();
      });

      test('should add "playwright-replaying" class to iframe-container', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

        const container = querySelectors.get('.iframe-container');
        expect(container?.classList.add).toHaveBeenCalledWith('playwright-replaying');
      });
    });

    describe('Deferred postMessage', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      test('should post structured steps to iframe after load fires and 250ms elapses', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
        const steps = TestDataFactories.createValidSteps();

        act(() => {
          result.current.startStructuredReplay(steps);
        });

        // Deferred: nothing sent until the reloaded document fires `load`.
        expect(mockIframeRef.current!.contentWindow.postMessage).not.toHaveBeenCalled();

        const loadCall = mockIframeRef.current!.addEventListener.mock.calls.find(
          (c) => c[0] === 'load'
        );
        const loadHandler = loadCall![1] as () => void;

        act(() => {
          loadHandler();
        });

        // load handler removes itself and only *schedules* the send.
        expect(mockIframeRef.current!.removeEventListener).toHaveBeenCalledWith('load', loadHandler);
        expect(mockIframeRef.current!.contentWindow.postMessage).not.toHaveBeenCalled();

        act(() => {
          vi.advanceTimersByTime(250);
        });

        expect(mockIframeRef.current!.contentWindow.postMessage).toHaveBeenCalledWith(
          { type: 'staktrak-playwright-replay-structured', actions: steps },
          '*'
        );
      });

      test('should reset replaying state if postMessage throws during deferred send', () => {
        const errorRef = TestDataFactories.createMockIframeRef();
        errorRef.current!.contentWindow.postMessage.mockImplementation(() => {
          throw new Error('PostMessage failed');
        });
        const { result } = renderHook(() => usePlaywrightReplay(errorRef));

        act(() => {
          result.current.startStructuredReplay(TestDataFactories.createValidSteps());
        });

        TestUtils.driveDeferredSend(errorRef);

        expect(result.current.isPlaywrightReplaying).toBe(false);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error starting structured replay:',
          expect.any(Error)
        );
      });
    });
  });

  describe('pausePlaywrightReplay', () => {
    test('should do nothing when not replaying', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      act(() => result.current.pausePlaywrightReplay());

      expect(mockIframeRef.current!.contentWindow.postMessage).not.toHaveBeenCalled();
      expect(result.current.isPlaywrightPaused).toBe(false);
    });

    test('should do nothing when iframe ref is null', () => {
      const nullRef = TestDataFactories.createMockIframeRef(false);
      const { result } = renderHook(() => usePlaywrightReplay(nullRef));

      act(() => result.current.pausePlaywrightReplay());

      expect(result.current.isPlaywrightPaused).toBe(false);
    });

    test('should send pause message when replaying', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      // Start replay first
      act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

      // Then pause
      act(() => result.current.pausePlaywrightReplay());

      expect(mockIframeRef.current!.contentWindow.postMessage).toHaveBeenCalledWith(
        { type: 'staktrak-playwright-replay-pause' },
        '*'
      );
      expect(result.current.isPlaywrightPaused).toBe(true);
      expect(result.current.playwrightStatus).toBe('paused');
    });

    test('should handle postMessage errors', () => {
      const errorRef = TestDataFactories.createMockIframeRef();
      const { result } = renderHook(() => usePlaywrightReplay(errorRef));

      // Start replay (deferred send is never driven, so no throw here)
      act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

      // Make postMessage throw on pause
      errorRef.current!.contentWindow.postMessage.mockImplementation(() => {
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

      expect(mockIframeRef.current!.contentWindow.postMessage).not.toHaveBeenCalled();
    });

    test('should do nothing when not paused', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      // Start replay but don't pause
      act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

      act(() => result.current.resumePlaywrightReplay());

      // resume requires the paused state, so no resume message is posted
      expect(mockIframeRef.current!.contentWindow.postMessage).not.toHaveBeenCalledWith(
        { type: 'staktrak-playwright-replay-resume' },
        '*'
      );
    });

    test('should do nothing when iframe ref is null', () => {
      const nullRef = TestDataFactories.createMockIframeRef(false);
      const { result } = renderHook(() => usePlaywrightReplay(nullRef));

      act(() => result.current.resumePlaywrightReplay());

      expect(result.current.playwrightStatus).toBe('idle');
    });

    test('should send resume message when paused', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      // Start replay, then pause
      act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));
      act(() => result.current.pausePlaywrightReplay());

      // Now resume
      act(() => result.current.resumePlaywrightReplay());

      expect(mockIframeRef.current!.contentWindow.postMessage).toHaveBeenCalledWith(
        { type: 'staktrak-playwright-replay-resume' },
        '*'
      );
      expect(result.current.isPlaywrightPaused).toBe(false);
      expect(result.current.playwrightStatus).toBe('playing');
    });

    test('should handle postMessage errors', () => {
      const errorRef = TestDataFactories.createMockIframeRef();
      const { result } = renderHook(() => usePlaywrightReplay(errorRef));

      // Start and pause
      act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));
      act(() => result.current.pausePlaywrightReplay());

      // Make postMessage throw on resume
      errorRef.current!.contentWindow.postMessage.mockImplementation(() => {
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

      expect(mockIframeRef.current!.contentWindow.postMessage).not.toHaveBeenCalled();
    });

    test('should do nothing when iframe ref is null', () => {
      const nullRef = TestDataFactories.createMockIframeRef(false);
      const { result } = renderHook(() => usePlaywrightReplay(nullRef));

      act(() => result.current.stopPlaywrightReplay());

      expect(result.current.playwrightStatus).toBe('idle');
    });

    test('should send stop message and reset all state', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      // Start replay
      act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

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

      expect(mockIframeRef.current!.contentWindow.postMessage).toHaveBeenCalledWith(
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

      act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));
      act(() => result.current.stopPlaywrightReplay());

      const container = querySelectors.get('.iframe-container');
      expect(container?.classList.remove).toHaveBeenCalledWith('playwright-replaying');
    });

    test('should handle postMessage errors', () => {
      const errorRef = TestDataFactories.createMockIframeRef();
      const { result } = renderHook(() => usePlaywrightReplay(errorRef));

      // Start replay
      act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

      // Make postMessage throw on stop
      errorRef.current!.contentWindow.postMessage.mockImplementation(() => {
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
        act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

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

        act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

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
        renderHook(() => usePlaywrightReplay(mockIframeRef));

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
        act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

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
        renderHook(() => usePlaywrightReplay(mockIframeRef));

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

      // Initial state
      TestUtils.expectInitialState(result);

      // Start
      act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));
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

      act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));
      expect(result.current.playwrightStatus).toBe('playing');

      act(() => result.current.stopPlaywrightReplay());
      expect(result.current.playwrightStatus).toBe('idle');
      expect(result.current.isPlaywrightReplaying).toBe(false);
    });

    test('should handle error during replay without stopping', async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

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
      const { unmount } = renderHook(() => usePlaywrightReplay(mockIframeRef));

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
      const steps = TestDataFactories.createValidSteps();

      act(() => result.current.startStructuredReplay(steps));
      act(() => result.current.startStructuredReplay(steps));

      // Each start registers a fresh one-time load listener and keeps replay active.
      expect(mockIframeRef.current!.addEventListener).toHaveBeenCalledTimes(2);
      expect(result.current.isPlaywrightReplaying).toBe(true);
    });

    test('should handle pause when already paused', () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));
      act(() => result.current.pausePlaywrightReplay());

      const callCount = mockIframeRef.current!.contentWindow.postMessage.mock.calls.length;

      act(() => result.current.pausePlaywrightReplay());

      // Should still send the pause message again
      expect(mockIframeRef.current!.contentWindow.postMessage.mock.calls.length).toBe(callCount + 1);
    });

    test('should handle a large steps array', () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));
      const steps = Array.from({ length: 1000 }, (_, i) => ({
        type: 'click',
        selector: `getByTestId:item-${i}`,
      }));

      let success: boolean;
      act(() => {
        success = result.current.startStructuredReplay(steps);
      });

      expect(success!).toBe(true);

      TestUtils.driveDeferredSend(mockIframeRef);

      expect(mockIframeRef.current!.contentWindow.postMessage).toHaveBeenCalledWith(
        { type: 'staktrak-playwright-replay-structured', actions: steps },
        '*'
      );
      vi.useRealTimers();
    });

    test('should handle rapid state changes', async () => {
      const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

      act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));
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

  describe('Screenshot Functionality', () => {
    describe('staktrak-playwright-screenshot-captured', () => {
      test('should add screenshot to replayScreenshots state', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-captured',
            id: 'screenshot-1',
            actionIndex: 0,
            screenshot: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
            timestamp: 1234567890,
            url: 'https://example.com/page1',
          });
        });

        await waitFor(() => {
          expect(result.current.replayScreenshots).toHaveLength(1);
          expect(result.current.replayScreenshots[0]).toEqual({
            id: 'screenshot-1',
            actionIndex: 0,
            dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
            timestamp: 1234567890,
            url: 'https://example.com/page1',
          });
        });
      });

      test('should map screenshot field to dataUrl', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        const dataUrl = 'data:image/jpeg;base64,testimage123';
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-captured',
            id: 'test-id',
            actionIndex: 2,
            screenshot: dataUrl,
            timestamp: Date.now(),
            url: 'https://example.com',
          });
        });

        await waitFor(() => {
          expect(result.current.replayScreenshots[0].dataUrl).toBe(dataUrl);
        });
      });

      test('should accumulate multiple screenshots in order', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        const screenshots = [
          {
            id: 'screenshot-1',
            actionIndex: 0,
            screenshot: 'data:image/jpeg;base64,first',
            timestamp: 1000,
            url: 'https://example.com/page1',
          },
          {
            id: 'screenshot-2',
            actionIndex: 1,
            screenshot: 'data:image/jpeg;base64,second',
            timestamp: 2000,
            url: 'https://example.com/page2',
          },
          {
            id: 'screenshot-3',
            actionIndex: 2,
            screenshot: 'data:image/jpeg;base64,third',
            timestamp: 3000,
            url: 'https://example.com/page3',
          },
        ];

        act(() => {
          screenshots.forEach((screenshot) => {
            TestUtils.simulateMessageEvent({
              type: 'staktrak-playwright-screenshot-captured',
              ...screenshot,
            });
          });
        });

        await waitFor(() => {
          expect(result.current.replayScreenshots).toHaveLength(3);
          expect(result.current.replayScreenshots[0].id).toBe('screenshot-1');
          expect(result.current.replayScreenshots[1].id).toBe('screenshot-2');
          expect(result.current.replayScreenshots[2].id).toBe('screenshot-3');
        });
      });

      test('should maintain screenshots during replay progress', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

        // Add screenshot
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-captured',
            id: 'screenshot-1',
            actionIndex: 0,
            screenshot: 'data:image/jpeg;base64,test',
            timestamp: Date.now(),
            url: 'https://example.com',
          });
        });

        // Trigger progress event
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-progress',
            current: 1,
            total: 5,
            action: 'click',
          });
        });

        await waitFor(() => {
          expect(result.current.replayScreenshots).toHaveLength(1);
          expect(result.current.playwrightProgress.current).toBe(1);
        });
      });

      test('should preserve screenshots when replay completes', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

        // Add screenshots
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-captured',
            id: 'screenshot-1',
            actionIndex: 0,
            screenshot: 'data:image/jpeg;base64,test1',
            timestamp: Date.now(),
            url: 'https://example.com/1',
          });
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-captured',
            id: 'screenshot-2',
            actionIndex: 1,
            screenshot: 'data:image/jpeg;base64,test2',
            timestamp: Date.now(),
            url: 'https://example.com/2',
          });
        });

        expect(result.current.replayScreenshots).toHaveLength(2);

        // Complete replay
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-completed',
          });
        });

        await waitFor(() => {
          expect(result.current.replayScreenshots).toHaveLength(2);
          expect(result.current.isPlaywrightReplaying).toBe(false);
          expect(result.current.playwrightStatus).toBe('completed');
        });
      });
    });

    describe('staktrak-playwright-screenshot-error', () => {
      test('should call onScreenshotError callback when provided', async () => {
        const onScreenshotError = vi.fn();
        renderHook(() => usePlaywrightReplay(mockIframeRef, null, null, null, onScreenshotError));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-error',
            actionIndex: 5,
            error: 'Failed to capture screenshot',
          });
        });

        await waitFor(() => {
          expect(onScreenshotError).toHaveBeenCalledWith('Screenshot capture failed for action 5');
          expect(onScreenshotError).toHaveBeenCalledTimes(1);
        });
      });

      test('should log warning to console when screenshot fails', async () => {
        renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-error',
            actionIndex: 3,
            error: 'Screenshot timeout',
          });
        });

        await waitFor(() => {
          expect(consoleWarnSpy).toHaveBeenCalledWith(
            'Screenshot failed for action 3:',
            'Screenshot timeout'
          );
        });
      });

      test('should not call onScreenshotError if callback not provided', async () => {
        renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-error',
            actionIndex: 1,
            error: 'Error',
          });
        });

        await waitFor(() => {
          expect(consoleWarnSpy).toHaveBeenCalled();
        });
      });

      test('should not stop replay when screenshot error occurs', async () => {
        const onScreenshotError = vi.fn();
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef, null, null, null, onScreenshotError));

        act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

        expect(result.current.isPlaywrightReplaying).toBe(true);

        // Trigger screenshot error
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-error',
            actionIndex: 1,
            error: 'Screenshot failed',
          });
        });

        await waitFor(() => {
          expect(result.current.isPlaywrightReplaying).toBe(true);
          expect(onScreenshotError).toHaveBeenCalled();
        });
      });

      test('should handle multiple screenshot errors', async () => {
        const onScreenshotError = vi.fn();
        renderHook(() => usePlaywrightReplay(mockIframeRef, null, null, null, onScreenshotError));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-error',
            actionIndex: 1,
            error: 'Error 1',
          });
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-error',
            actionIndex: 2,
            error: 'Error 2',
          });
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-error',
            actionIndex: 3,
            error: 'Error 3',
          });
        });

        await waitFor(() => {
          expect(onScreenshotError).toHaveBeenCalledTimes(3);
          expect(onScreenshotError).toHaveBeenNthCalledWith(
            1,
            'Screenshot capture failed for action 1'
          );
          expect(onScreenshotError).toHaveBeenNthCalledWith(
            2,
            'Screenshot capture failed for action 2'
          );
          expect(onScreenshotError).toHaveBeenNthCalledWith(
            3,
            'Screenshot capture failed for action 3'
          );
        });
      });
    });

    describe('Screenshot State Lifecycle', () => {
      test('should initialize with empty screenshots array', () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        expect(result.current.replayScreenshots).toEqual([]);
        expect(result.current.replayActions).toEqual([]);
      });

      test('should clear screenshots when starting new replay', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Add screenshots
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-captured',
            id: 'screenshot-1',
            actionIndex: 0,
            screenshot: 'data:image/jpeg;base64,test',
            timestamp: Date.now(),
            url: 'https://example.com',
          });
        });

        expect(result.current.replayScreenshots).toHaveLength(1);

        // Start new replay
        act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

        await waitFor(() => {
          expect(result.current.replayScreenshots).toEqual([]);
        });
      });

      test('should maintain screenshots after stopping replay', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

        // Add screenshot
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-captured',
            id: 'screenshot-1',
            actionIndex: 0,
            screenshot: 'data:image/jpeg;base64,test',
            timestamp: Date.now(),
            url: 'https://example.com',
          });
        });

        // Stop replay
        act(() => result.current.stopPlaywrightReplay());

        await waitFor(() => {
          expect(result.current.replayScreenshots).toHaveLength(1);
          expect(result.current.isPlaywrightReplaying).toBe(false);
        });
      });

      test('should clear actions when starting new replay', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        // Add actions via started message
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-started',
            totalActions: 5,
            actions: [{ type: 'click' }, { type: 'fill' }],
          });
        });

        expect(result.current.replayActions).toHaveLength(2);

        // Start new replay
        act(() => result.current.startStructuredReplay(TestDataFactories.createValidSteps()));

        await waitFor(() => {
          expect(result.current.replayActions).toEqual([]);
        });
      });
    });

    describe('Replay Actions State', () => {
      test('should set replayActions when replay starts', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        const mockActions = [
          { type: 'goto', url: 'https://example.com' },
          { type: 'click', selector: '.button' },
          { type: 'fill', selector: 'input', value: 'test' },
        ];

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-started',
            totalActions: 3,
            actions: mockActions,
          });
        });

        await waitFor(() => {
          expect(result.current.replayActions).toEqual(mockActions);
          expect(result.current.playwrightProgress.total).toBe(3);
        });
      });

      test('should handle empty actions array', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-started',
            totalActions: 0,
            actions: [],
          });
        });

        await waitFor(() => {
          expect(result.current.replayActions).toEqual([]);
        });
      });

      test('should default to empty array if actions not provided', async () => {
        const { result } = renderHook(() => usePlaywrightReplay(mockIframeRef));

        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-replay-started',
            totalActions: 5,
          });
        });

        await waitFor(() => {
          expect(result.current.replayActions).toEqual([]);
        });
      });
    });

    describe('Screenshot and Error Callback Dependencies', () => {
      test('should re-register listener when onScreenshotError callback changes', async () => {
        const callback1 = vi.fn();
        const callback2 = vi.fn();

        const { rerender } = renderHook(
          ({ callback }) => usePlaywrightReplay(mockIframeRef, null, null, null, callback),
          {
            initialProps: { callback: callback1 },
          }
        );

        // Trigger screenshot error with first callback
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-error',
            actionIndex: 1,
            error: 'Error 1',
          });
        });

        await waitFor(() => {
          expect(callback1).toHaveBeenCalledWith('Screenshot capture failed for action 1');
        });

        // Change callback
        rerender({ callback: callback2 });

        // Trigger screenshot error with second callback
        act(() => {
          TestUtils.simulateMessageEvent({
            type: 'staktrak-playwright-screenshot-error',
            actionIndex: 2,
            error: 'Error 2',
          });
        });

        await waitFor(() => {
          expect(callback2).toHaveBeenCalledWith('Screenshot capture failed for action 2');
        });
      });
    });
  });
});
