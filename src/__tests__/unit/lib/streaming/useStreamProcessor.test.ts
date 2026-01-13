import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useStreamProcessor } from "@/lib/streaming/useStreamProcessor";
import type { BaseStreamingMessage, StreamProcessorConfig, ToolProcessor } from "@/types/streaming";
import { DEFAULT_DEBOUNCE_MS } from "@/lib/streaming/constants";

// Test data factories
const TestDataFactories = {
  createSSEEvent: (type: string, data: Record<string, unknown>) => {
    return `data: ${JSON.stringify({ type, ...data })}\n\n`;
  },

  createTextStartEvent: (id: string) => {
    return TestDataFactories.createSSEEvent("text-start", { id });
  },

  createTextDeltaEvent: (id: string, text: string) => {
    return TestDataFactories.createSSEEvent("text-delta", { id, text });
  },

  createReasoningStartEvent: (id: string) => {
    return TestDataFactories.createSSEEvent("reasoning-start", { id });
  },

  createReasoningDeltaEvent: (id: string, text: string) => {
    return TestDataFactories.createSSEEvent("reasoning-delta", { id, text });
  },

  createToolInputStartEvent: (toolCallId: string, toolName: string) => {
    return TestDataFactories.createSSEEvent("tool-input-start", {
      toolCallId,
      toolName,
    });
  },

  createToolInputDeltaEvent: (toolCallId: string, inputTextDelta: string) => {
    return TestDataFactories.createSSEEvent("tool-input-delta", {
      toolCallId,
      inputTextDelta,
    });
  },

  createToolInputAvailableEvent: (toolCallId: string, input: unknown) => {
    return TestDataFactories.createSSEEvent("tool-input-available", {
      toolCallId,
      input,
    });
  },

  createToolOutputAvailableEvent: (toolCallId: string, output: unknown) => {
    return TestDataFactories.createSSEEvent("tool-output-available", {
      toolCallId,
      output,
    });
  },

  createToolOutputErrorEvent: (toolCallId: string, errorText: string) => {
    return TestDataFactories.createSSEEvent("tool-output-error", {
      toolCallId,
      errorText,
    });
  },

  createErrorEvent: (errorText: string) => {
    return TestDataFactories.createSSEEvent("error", { errorText });
  },

  // AI SDK native tool events
  createToolCallEvent: (toolCallId: string, toolName: string, input: unknown) => {
    return TestDataFactories.createSSEEvent("tool-call", {
      toolCallId,
      toolName,
      input,
    });
  },

  createToolResultEvent: (toolCallId: string, toolName: string, output: unknown) => {
    return TestDataFactories.createSSEEvent("tool-result", {
      toolCallId,
      toolName,
      output,
    });
  },

  createToolErrorEvent: (toolCallId: string, toolName: string, input: unknown, error: string) => {
    return TestDataFactories.createSSEEvent("tool-error", {
      toolCallId,
      toolName,
      input,
      error,
    });
  },

  createStartEvent: () => {
    return TestDataFactories.createSSEEvent("start", {});
  },

  createFinishEvent: (finishReason: string) => {
    return TestDataFactories.createSSEEvent("finish", { finishReason });
  },

  createMockResponse: (sseEvents: string[]): Response => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (const event of sseEvents) {
          controller.enqueue(encoder.encode(event));
        }
        controller.close();
      },
    });

    return {
      body: stream,
      ok: true,
      status: 200,
    } as Response;
  },

  createStreamConfig: (overrides: Partial<StreamProcessorConfig> = {}): StreamProcessorConfig => {
    return {
      debounceMs: DEFAULT_DEBOUNCE_MS,
      toolProcessors: {},
      hiddenTools: [],
      hiddenToolTextIds: {},
      ...overrides,
    };
  },
};

// Test utilities
const TestUtils = {
  waitForDebounce: async (debounceMs: number = DEFAULT_DEBOUNCE_MS) => {
    vi.advanceTimersByTime(debounceMs);
    await waitFor(() => expect(true).toBe(true));
  },

  createOnUpdateSpy: () => {
    return vi.fn<(message: BaseStreamingMessage) => void>();
  },

  expectMessageStructure: (message: BaseStreamingMessage) => {
    expect(message).toHaveProperty("id");
    expect(message).toHaveProperty("content");
    expect(message).toHaveProperty("isStreaming");
    expect(message).toHaveProperty("isError");
    expect(message).toHaveProperty("textParts");
    expect(message).toHaveProperty("reasoningParts");
    expect(message).toHaveProperty("toolCalls");
  },
};

describe("useStreamProcessor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("Hook Initialization", () => {
    test("should initialize with default config", () => {
      const { result } = renderHook(() => useStreamProcessor());

      expect(result.current).toHaveProperty("processStream");
      expect(typeof result.current.processStream).toBe("function");
    });

    test("should accept custom config", () => {
      const config = TestDataFactories.createStreamConfig({
        debounceMs: 100,
        toolProcessors: {
          test_tool: (output) => output,
        },
      });

      const { result } = renderHook(() => useStreamProcessor(config));

      expect(result.current).toHaveProperty("processStream");
    });

    test("should handle empty config", () => {
      const { result } = renderHook(() => useStreamProcessor({}));

      expect(result.current.processStream).toBeDefined();
    });
  });

  describe("Text Event Processing", () => {
    test("should process text-start event", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [TestDataFactories.createTextStartEvent("text-1")];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      expect(onUpdate).toHaveBeenCalled();
      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.textParts).toHaveLength(1);
      // ID is now prefixed with sequence number to handle duplicate IDs from stream
      expect(finalMessage.textParts![0].id).toMatch(/^text-1-\d+$/);
      expect(finalMessage.isStreaming).toBe(false);
    });

    test("should accumulate text-delta events", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createTextStartEvent("text-1"),
        TestDataFactories.createTextDeltaEvent("text-1", "Hello "),
        TestDataFactories.createTextDeltaEvent("text-1", "world"),
        TestDataFactories.createTextDeltaEvent("text-1", "!"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.content).toBe("Hello world!");
      expect(finalMessage.textParts![0].content).toBe("Hello world!");
    });

    test("should handle multiple text parts", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createTextStartEvent("text-1"),
        TestDataFactories.createTextDeltaEvent("text-1", "First part"),
        TestDataFactories.createTextStartEvent("text-2"),
        TestDataFactories.createTextDeltaEvent("text-2", "Second part"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.textParts).toHaveLength(2);
      expect(finalMessage.textParts![0].content).toBe("First part");
      expect(finalMessage.textParts![1].content).toBe("Second part");
      expect(finalMessage.content).toBe("First partSecond part");
    });
  });

  describe("Reasoning Event Processing", () => {
    test("should process reasoning-start event", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [TestDataFactories.createReasoningStartEvent("reasoning-1")];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.reasoningParts).toHaveLength(1);
      expect(finalMessage.reasoningParts![0].id).toBe("reasoning-1");
    });

    test("should accumulate reasoning-delta events", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createReasoningStartEvent("reasoning-1"),
        TestDataFactories.createReasoningDeltaEvent("reasoning-1", "Step 1: "),
        TestDataFactories.createReasoningDeltaEvent("reasoning-1", "Analyze problem"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.reasoningParts![0].content).toBe("Step 1: Analyze problem");
    });

    test("should handle multiple reasoning parts", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createReasoningStartEvent("reasoning-1"),
        TestDataFactories.createReasoningDeltaEvent("reasoning-1", "First reasoning"),
        TestDataFactories.createReasoningStartEvent("reasoning-2"),
        TestDataFactories.createReasoningDeltaEvent("reasoning-2", "Second reasoning"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.reasoningParts).toHaveLength(2);
      expect(finalMessage.reasoningParts![0].content).toBe("First reasoning");
      expect(finalMessage.reasoningParts![1].content).toBe("Second reasoning");
    });
  });

  describe("Tool Call Processing", () => {
    test("should process tool-input-start event", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [TestDataFactories.createToolInputStartEvent("tool-1", "search_web")];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.toolCalls).toHaveLength(1);
      expect(finalMessage.toolCalls![0].toolName).toBe("search_web");
      expect(finalMessage.toolCalls![0].status).toBe("input-start");
    });

    test("should accumulate tool-input-delta events", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createToolInputStartEvent("tool-1", "search_web"),
        TestDataFactories.createToolInputDeltaEvent("tool-1", "query: "),
        TestDataFactories.createToolInputDeltaEvent("tool-1", "test search"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.toolCalls![0].inputText).toBe("query: test search");
      expect(finalMessage.toolCalls![0].status).toBe("input-delta");
    });

    test("should process tool-input-available event", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const toolInput = { query: "test search" };
      const events = [
        TestDataFactories.createToolInputStartEvent("tool-1", "search_web"),
        TestDataFactories.createToolInputAvailableEvent("tool-1", toolInput),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.toolCalls![0].input).toEqual(toolInput);
      expect(finalMessage.toolCalls![0].status).toBe("input-available");
    });

    test("should process tool-output-available event", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const toolOutput = { results: ["result1", "result2"] };
      const events = [
        TestDataFactories.createToolInputStartEvent("tool-1", "search_web"),
        TestDataFactories.createToolOutputAvailableEvent("tool-1", toolOutput),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.toolCalls![0].output).toEqual(toolOutput);
      expect(finalMessage.toolCalls![0].status).toBe("output-available");
    });

    test("should process tool-output-error event", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createToolInputStartEvent("tool-1", "search_web"),
        TestDataFactories.createToolOutputErrorEvent("tool-1", "Search failed"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.toolCalls![0].status).toBe("output-error");
      expect(finalMessage.toolCalls![0].errorText).toBe("Search failed");
    });

    // AI SDK native tool events
    test("should process tool-call event (AI SDK native)", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const toolInput = { query: "test search" };
      const events = [TestDataFactories.createToolCallEvent("tool-1", "search_web", toolInput)];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.toolCalls).toHaveLength(1);
      expect(finalMessage.toolCalls![0].toolName).toBe("search_web");
      expect(finalMessage.toolCalls![0].input).toEqual(toolInput);
      expect(finalMessage.toolCalls![0].status).toBe("input-available");
    });

    test("should process tool-result event (AI SDK native)", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const toolInput = { query: "test" };
      const toolOutput = { results: ["result1", "result2"] };
      const events = [
        TestDataFactories.createToolCallEvent("tool-1", "search_web", toolInput),
        TestDataFactories.createToolResultEvent("tool-1", "search_web", toolOutput),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.toolCalls![0].output).toEqual(toolOutput);
      expect(finalMessage.toolCalls![0].status).toBe("output-available");
    });

    test("should process tool-error event (AI SDK native)", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const toolInput = { query: "test" };
      const events = [
        TestDataFactories.createToolCallEvent("tool-1", "search_web", toolInput),
        TestDataFactories.createToolErrorEvent("tool-1", "search_web", toolInput, "Search failed"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.toolCalls![0].status).toBe("output-error");
      expect(finalMessage.toolCalls![0].errorText).toBe("Search failed");
    });

    test("should apply tool processor to tool-result event", async () => {
      const toolProcessor: ToolProcessor = (output) => {
        return { processed: true, original: output };
      };

      const config = TestDataFactories.createStreamConfig({
        toolProcessors: {
          search_web: toolProcessor,
        },
      });

      const { result } = renderHook(() => useStreamProcessor(config));
      const onUpdate = TestUtils.createOnUpdateSpy();

      const toolInput = { query: "test" };
      const toolOutput = { results: ["test"] };
      const events = [
        TestDataFactories.createToolCallEvent("tool-1", "search_web", toolInput),
        TestDataFactories.createToolResultEvent("tool-1", "search_web", toolOutput),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.toolCalls![0].output).toEqual({
        processed: true,
        original: toolOutput,
      });
    });

    test("should convert hidden tool-call/tool-result to text part", async () => {
      const config = TestDataFactories.createStreamConfig({
        hiddenTools: ["final_answer"],
        hiddenToolTextIds: { final_answer: "final-text" },
        toolProcessors: {
          final_answer: (output) => String(output),
        },
      });

      const { result } = renderHook(() => useStreamProcessor(config));
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createToolCallEvent("tool-1", "final_answer", { answer: "test" }),
        TestDataFactories.createToolResultEvent("tool-1", "final_answer", "This is the answer"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.toolCalls).toHaveLength(0);
      expect(finalMessage.textParts?.some((p) => p.id === "final-text")).toBe(true);
      expect(finalMessage.textParts?.find((p) => p.id === "final-text")?.content).toBe("This is the answer");
    });
  });

  describe("Tool Processors", () => {
    test("should apply tool processor to output", async () => {
      const toolProcessor: ToolProcessor = (output) => {
        return { processed: true, original: output };
      };

      const config = TestDataFactories.createStreamConfig({
        toolProcessors: {
          search_web: toolProcessor,
        },
      });

      const { result } = renderHook(() => useStreamProcessor(config));
      const onUpdate = TestUtils.createOnUpdateSpy();

      const toolOutput = { results: ["test"] };
      const events = [
        TestDataFactories.createToolInputStartEvent("tool-1", "search_web"),
        TestDataFactories.createToolOutputAvailableEvent("tool-1", toolOutput),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.toolCalls![0].output).toEqual({
        processed: true,
        original: toolOutput,
      });
    });

    test("should share context between tool processors", async () => {
      const processor1: ToolProcessor = (output, context) => {
        const result = { data: "processed1" };
        return result;
      };

      const processor2: ToolProcessor = (output, context) => {
        // Access previous tool's result from context
        const previousResult = context?.search_web as { data: string };
        return { data: "processed2", previous: previousResult?.data };
      };

      const config = TestDataFactories.createStreamConfig({
        toolProcessors: {
          search_web: processor1,
          final_answer: processor2,
        },
      });

      const { result } = renderHook(() => useStreamProcessor(config));
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createToolInputStartEvent("tool-1", "search_web"),
        TestDataFactories.createToolOutputAvailableEvent("tool-1", { raw: "data1" }),
        TestDataFactories.createToolInputStartEvent("tool-2", "final_answer"),
        TestDataFactories.createToolOutputAvailableEvent("tool-2", { raw: "data2" }),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.toolCalls).toHaveLength(2);
      expect(finalMessage.toolCalls![1].output).toEqual({
        data: "processed2",
        previous: "processed1",
      });
    });

    test("should handle tool processor errors gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const toolProcessor: ToolProcessor = () => {
        throw new Error("Processor error");
      };

      const config = TestDataFactories.createStreamConfig({
        toolProcessors: {
          search_web: toolProcessor,
        },
      });

      const { result } = renderHook(() => useStreamProcessor(config));
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createToolInputStartEvent("tool-1", "search_web"),
        TestDataFactories.createToolOutputAvailableEvent("tool-1", { data: "test" }),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Tool processor error for search_web"),
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Hidden Tools", () => {
    test("should convert hidden tool output to text part", async () => {
      const config = TestDataFactories.createStreamConfig({
        hiddenTools: ["final_answer"],
        hiddenToolTextIds: { final_answer: "final-text" },
        toolProcessors: {
          final_answer: (output) => String(output),
        },
      });

      const { result } = renderHook(() => useStreamProcessor(config));
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createToolInputStartEvent("tool-1", "final_answer"),
        TestDataFactories.createToolOutputAvailableEvent("tool-1", "This is the answer"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.toolCalls).toHaveLength(0);
      expect(finalMessage.textParts?.some((p) => p.id === "final-text")).toBe(true);
      expect(finalMessage.textParts?.find((p) => p.id === "final-text")?.content).toBe("This is the answer");
    });

    test("should not show hidden tool in toolCalls", async () => {
      const config = TestDataFactories.createStreamConfig({
        hiddenTools: ["final_answer"],
      });

      const { result } = renderHook(() => useStreamProcessor(config));
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createToolInputStartEvent("tool-1", "search_web"),
        TestDataFactories.createToolOutputAvailableEvent("tool-1", { results: [] }),
        TestDataFactories.createToolInputStartEvent("tool-2", "final_answer"),
        TestDataFactories.createToolOutputAvailableEvent("tool-2", "Final answer text"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      // Only search_web should appear in toolCalls
      expect(finalMessage.toolCalls).toHaveLength(1);
      expect(finalMessage.toolCalls![0].toolName).toBe("search_web");
    });

    test("should use default ID if hiddenToolTextIds not provided", async () => {
      const config = TestDataFactories.createStreamConfig({
        hiddenTools: ["final_answer"],
        toolProcessors: {
          final_answer: (output) => String(output),
        },
      });

      const { result } = renderHook(() => useStreamProcessor(config));
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createToolInputStartEvent("tool-1", "final_answer"),
        TestDataFactories.createToolOutputAvailableEvent("tool-1", "Answer text"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.textParts?.some((p) => p.id === "final_answer-output")).toBe(true);
    });

    test("should handle hidden tool processor errors", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const config = TestDataFactories.createStreamConfig({
        hiddenTools: ["final_answer"],
        toolProcessors: {
          final_answer: () => {
            throw new Error("Hidden processor error");
          },
        },
      });

      const { result } = renderHook(() => useStreamProcessor(config));
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createToolInputStartEvent("tool-1", "final_answer"),
        TestDataFactories.createToolOutputAvailableEvent("tool-1", "Answer"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Hidden tool processor error for final_answer"),
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Debouncing", () => {
    test("should debounce updates during streaming", async () => {
      const config = TestDataFactories.createStreamConfig({ debounceMs: 100 });
      const { result } = renderHook(() => useStreamProcessor(config));
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createTextStartEvent("text-1"),
        TestDataFactories.createTextDeltaEvent("text-1", "a"),
        TestDataFactories.createTextDeltaEvent("text-1", "b"),
        TestDataFactories.createTextDeltaEvent("text-1", "c"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      const processPromise = result.current.processStream(response, "msg-1", onUpdate);

      // Advance timers to trigger debounced updates
      await vi.runAllTimersAsync();
      await processPromise;

      // Should have intermediate debounced updates + final update
      expect(onUpdate.mock.calls.length).toBeGreaterThanOrEqual(1);

      // Final message should have complete content
      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.content).toBe("abc");
      expect(finalMessage.isStreaming).toBe(false);
    });

    test("should respect custom debounce delay", async () => {
      const customDebounce = 200;
      const config = TestDataFactories.createStreamConfig({
        debounceMs: customDebounce,
      });
      const { result } = renderHook(() => useStreamProcessor(config));
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createTextStartEvent("text-1"),
        TestDataFactories.createTextDeltaEvent("text-1", "test"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      const processPromise = result.current.processStream(response, "msg-1", onUpdate);

      await vi.runAllTimersAsync();
      await processPromise;

      expect(onUpdate).toHaveBeenCalled();
    });

    test("should clear debounce timer on stream completion", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createTextStartEvent("text-1"),
        TestDataFactories.createTextDeltaEvent("text-1", "complete"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      const processPromise = result.current.processStream(response, "msg-1", onUpdate);
      await vi.runAllTimersAsync();
      await processPromise;

      // Final update should have isStreaming: false
      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.isStreaming).toBe(false);
    });
  });

  describe("Error Handling", () => {
    test("should handle error events", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [TestDataFactories.createErrorEvent("Stream processing error")];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.isError).toBe(true);
      expect(finalMessage.error).toBe("Stream processing error");
    });

    test("should throw error when no reader available", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const response = { body: null } as Response;

      await expect(result.current.processStream(response, "msg-1", onUpdate)).rejects.toThrow(
        "No response body reader available",
      );
    });

    test("should handle malformed JSON in stream", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode("data: {invalid json}\n\n"));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      const response = { body: stream } as Response;

      await result.current.processStream(response, "msg-1", onUpdate);

      expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to parse stream chunk:", expect.any(Error));

      consoleErrorSpy.mockRestore();
    });

    test("should handle stream read errors", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const stream = new ReadableStream({
        async start(controller) {
          controller.error(new Error("Stream read error"));
        },
      });

      const response = { body: stream } as Response;

      await expect(result.current.processStream(response, "msg-1", onUpdate)).rejects.toThrow("Stream read error");
    });
  });

  describe("Message Building", () => {
    test("should build message with all parts", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createTextStartEvent("text-1"),
        TestDataFactories.createTextDeltaEvent("text-1", "Text content"),
        TestDataFactories.createReasoningStartEvent("reasoning-1"),
        TestDataFactories.createReasoningDeltaEvent("reasoning-1", "Reasoning content"),
        TestDataFactories.createToolInputStartEvent("tool-1", "search"),
        TestDataFactories.createToolOutputAvailableEvent("tool-1", { data: "result" }),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      TestUtils.expectMessageStructure(finalMessage);
      expect(finalMessage.textParts).toHaveLength(1);
      expect(finalMessage.reasoningParts).toHaveLength(1);
      expect(finalMessage.toolCalls).toHaveLength(1);
    });

    test("should include additional fields", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const additionalFields = {
        role: "assistant" as const,
        timestamp: new Date(),
        customField: "custom value",
      };

      const events = [
        TestDataFactories.createTextStartEvent("text-1"),
        TestDataFactories.createTextDeltaEvent("text-1", "content"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate, additionalFields as any);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect((finalMessage as any).role).toBe("assistant");
      expect((finalMessage as any).timestamp).toBeInstanceOf(Date);
      expect((finalMessage as any).customField).toBe("custom value");
    });

    test("should set correct message ID", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const messageId = "test-message-123";
      const events = [TestDataFactories.createTextStartEvent("text-1")];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, messageId, onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.id).toBe(messageId);
    });

    test("should concatenate multiple text parts in content", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createTextStartEvent("text-1"),
        TestDataFactories.createTextDeltaEvent("text-1", "Part 1 "),
        TestDataFactories.createTextStartEvent("text-2"),
        TestDataFactories.createTextDeltaEvent("text-2", "Part 2 "),
        TestDataFactories.createTextStartEvent("text-3"),
        TestDataFactories.createTextDeltaEvent("text-3", "Part 3"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.content).toBe("Part 1 Part 2 Part 3");
    });
  });

  describe("Stream Event Parsing", () => {
    test("should skip non-data lines", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(": comment line\n"));
          controller.enqueue(encoder.encode('data: {"type":"text-start","id":"text-1"}\n\n'));
          controller.enqueue(encoder.encode("event: custom\n"));
          controller.close();
        },
      });

      const response = { body: stream } as Response;

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.textParts).toHaveLength(1);
    });

    test("should handle [DONE] marker", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"text-start","id":"text-1"}\n\n'));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      const response = { body: stream } as Response;

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage).toBeDefined();
    });

    test("should handle empty data lines", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode("data: \n\n"));
          controller.enqueue(encoder.encode('data: {"type":"text-start","id":"text-1"}\n\n'));
          controller.close();
        },
      });

      const response = { body: stream } as Response;

      await result.current.processStream(response, "msg-1", onUpdate);

      expect(onUpdate).toHaveBeenCalled();
    });
  });

  describe("Complex Scenarios", () => {
    test("should handle complete streaming flow with all event types", async () => {
      const config = TestDataFactories.createStreamConfig({
        toolProcessors: {
          web_search: (output) => ({ processed: true, data: output }),
          final_answer: (output) => String(output),
        },
        hiddenTools: ["final_answer"],
        hiddenToolTextIds: { final_answer: "final" },
      });

      const { result } = renderHook(() => useStreamProcessor(config));
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = [
        TestDataFactories.createTextStartEvent("text-1"),
        TestDataFactories.createTextDeltaEvent("text-1", "Searching for information..."),
        TestDataFactories.createReasoningStartEvent("reasoning-1"),
        TestDataFactories.createReasoningDeltaEvent("reasoning-1", "Step 1: Analyze query"),
        TestDataFactories.createToolInputStartEvent("tool-1", "web_search"),
        TestDataFactories.createToolInputDeltaEvent("tool-1", "query: test"),
        TestDataFactories.createToolInputAvailableEvent("tool-1", { query: "test" }),
        TestDataFactories.createToolOutputAvailableEvent("tool-1", {
          results: ["result1"],
        }),
        TestDataFactories.createToolInputStartEvent("tool-2", "final_answer"),
        TestDataFactories.createToolOutputAvailableEvent("tool-2", "Final answer text"),
      ];
      const response = TestDataFactories.createMockResponse(events);

      await result.current.processStream(response, "msg-1", onUpdate);

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];

      // Check all parts are present
      expect(finalMessage.textParts?.length).toBeGreaterThan(0);
      expect(finalMessage.reasoningParts).toHaveLength(1);
      expect(finalMessage.toolCalls).toHaveLength(1); // Only web_search, final_answer is hidden
      expect(finalMessage.toolCalls![0].toolName).toBe("web_search");
      expect(finalMessage.toolCalls![0].output).toEqual({
        processed: true,
        data: { results: ["result1"] },
      });

      // Hidden tool output should be in text parts
      expect(finalMessage.textParts?.some((p) => p.id === "final")).toBe(true);
      expect(finalMessage.isStreaming).toBe(false);
    });

    test("should handle rapid successive updates", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const events = Array.from({ length: 50 }, (_, i) =>
        TestDataFactories.createTextDeltaEvent("text-1", `word${i} `),
      );
      events.unshift(TestDataFactories.createTextStartEvent("text-1"));

      const response = TestDataFactories.createMockResponse(events);

      const processPromise = result.current.processStream(response, "msg-1", onUpdate);
      await vi.runAllTimersAsync();
      await processPromise;

      const finalMessage = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(finalMessage.content).toContain("word0");
      expect(finalMessage.content).toContain("word49");
    });

    test("should handle empty stream", async () => {
      const { result } = renderHook(() => useStreamProcessor());
      const onUpdate = TestUtils.createOnUpdateSpy();

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.close();
        },
      });

      const response = { body: stream } as Response;

      await result.current.processStream(response, "msg-1", onUpdate);

      // Should still call onUpdate with final message
      expect(onUpdate).toHaveBeenCalledTimes(1);
      const finalMessage = onUpdate.mock.calls[0][0];
      expect(finalMessage.isStreaming).toBe(false);
      expect(finalMessage.content).toBe("");
    });
  });
});
