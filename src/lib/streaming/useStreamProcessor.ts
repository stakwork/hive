import { useCallback } from "react";
import type {
  BaseStreamingMessage,
  StreamProcessorConfig,
  StreamEvent,
  ToolCallStatus,
} from "@/types/streaming";
import { DEFAULT_DEBOUNCE_MS } from "./constants";
import { parseSSELine } from "./helpers";

interface InternalToolCall {
  toolName: string;
  input?: unknown;
  inputText?: string;
  output?: unknown;
  status: ToolCallStatus;
  errorText?: string;
}

/**
 * Generic streaming processor hook for AI SDK responses
 *
 * @example
 * const { processStream } = useStreamProcessor({
 *   debounceMs: 50,
 *   toolProcessors: {
 *     web_search: (output) => processWebSearchResults(output),
 *     final_answer: (output, context) => processFinalAnswer(output, context)
 *   }
 * });
 *
 * await processStream(response, messageId, (message) => {
 *   setMessages(prev => [...prev, message]);
 * });
 */
export function useStreamProcessor<T extends BaseStreamingMessage = BaseStreamingMessage>(
  config: StreamProcessorConfig = {}
) {
  const {
    debounceMs = DEFAULT_DEBOUNCE_MS,
    toolProcessors = {},
    hiddenTools = [],
    hiddenToolTextIds = {},
  } = config;

  const processStream = useCallback(
    async (
      response: Response,
      messageId: string,
      onUpdate: (message: T) => void,
      additionalFields?: Partial<T>
    ) => {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body reader available");
      }

      const textParts = new Map<string, string>();
      const reasoningParts = new Map<string, string>();
      const toolCalls = new Map<string, InternalToolCall>();
      const hiddenToolCallIds = new Map<string, string>(); // callId -> toolName
      let error: string | undefined;

      // Context for tool processors (can be used to pass state between processors)
      const processorContext: Record<string, unknown> = {};

      // Debounce mechanism
      let debounceTimer: NodeJS.Timeout | null = null;

      const buildMessage = (isStreaming: boolean): T => {
        const allTextParts = Array.from(textParts.entries()).map(([id, content]) => ({
          id,
          content,
        }));

        return {
          id: messageId,
          content: Array.from(textParts.values()).join(""),
          isStreaming,
          isError: !!error,
          textParts: allTextParts,
          reasoningParts: Array.from(reasoningParts.entries()).map(([id, content]) => ({
            id,
            content,
          })),
          toolCalls: Array.from(toolCalls.entries()).map(([id, call]) => ({
            id,
            ...call,
          })),
          error,
          ...additionalFields,
        } as T;
      };

      const updateMessage = () => {
        onUpdate(buildMessage(true));
      };

      const debouncedUpdate = () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(updateMessage, debounceMs);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          const jsonStr = parseSSELine(line);
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr) as StreamEvent;

            if (data.type === "text-start") {
              textParts.set(data.id, "");
            } else if (data.type === "text-delta") {
              textParts.set(data.id, (textParts.get(data.id) || "") + data.delta);
            } else if (data.type === "reasoning-start") {
              reasoningParts.set(data.id, "");
            } else if (data.type === "reasoning-delta") {
              reasoningParts.set(data.id, (reasoningParts.get(data.id) || "") + data.delta);
            } else if (data.type === "tool-input-start") {
              // Track hidden tools separately
              if (hiddenTools.includes(data.toolName)) {
                hiddenToolCallIds.set(data.toolCallId, data.toolName);
              } else {
                toolCalls.set(data.toolCallId, {
                  toolName: data.toolName,
                  status: "input-start",
                });
              }
            } else if (data.type === "tool-input-delta") {
              const existing = toolCalls.get(data.toolCallId);
              if (existing) {
                toolCalls.set(data.toolCallId, {
                  ...existing,
                  inputText: (existing.inputText || "") + data.inputTextDelta,
                  status: "input-delta",
                });
              }
            } else if (data.type === "tool-input-available") {
              const existing = toolCalls.get(data.toolCallId);
              if (existing) {
                toolCalls.set(data.toolCallId, {
                  ...existing,
                  input: data.input,
                  status: "input-available",
                });
              }
            } else if (data.type === "tool-input-error") {
              const existing = toolCalls.get(data.toolCallId);
              if (existing) {
                toolCalls.set(data.toolCallId, {
                  ...existing,
                  input: data.input,
                  status: "input-error",
                  errorText: data.errorText,
                });
              }
            } else if (data.type === "tool-output-available") {
              const hiddenToolName = hiddenToolCallIds.get(data.toolCallId);

              // Handle hidden tools - add their output as text parts
              if (hiddenToolName) {
                const processor = toolProcessors[hiddenToolName];
                let processedOutput = data.output;

                if (processor) {
                  try {
                    processedOutput = processor(data.output, processorContext);
                    processorContext[hiddenToolName] = processedOutput;
                  } catch (err) {
                    console.error(`Hidden tool processor error for ${hiddenToolName}:`, err);
                  }
                }

                // Add to text parts with custom ID
                const textId = hiddenToolTextIds[hiddenToolName] || `${hiddenToolName}-output`;
                if (typeof processedOutput === "string") {
                  textParts.set(textId, processedOutput);
                }
              } else {
                // Regular tool call
                const existing = toolCalls.get(data.toolCallId);
                if (existing) {
                  const processor = toolProcessors[existing.toolName];
                  let processedOutput = data.output;

                  if (processor) {
                    try {
                      processedOutput = processor(data.output, processorContext);
                      // Store result in context for other processors to use
                      processorContext[existing.toolName] = processedOutput;
                    } catch (err) {
                      console.error(`Tool processor error for ${existing.toolName}:`, err);
                    }
                  }

                  toolCalls.set(data.toolCallId, {
                    ...existing,
                    output: processedOutput,
                    status: "output-available",
                  });
                }
              }
            } else if (data.type === "tool-output-error") {
              const existing = toolCalls.get(data.toolCallId);
              if (existing) {
                toolCalls.set(data.toolCallId, {
                  ...existing,
                  status: "output-error",
                  errorText: data.errorText,
                });
              }
            } else if (data.type === "error") {
              error = data.errorText;
            }

            // Only update if there's content to show
            if (
              textParts.size > 0 ||
              toolCalls.size > 0 ||
              reasoningParts.size > 0 ||
              error
            ) {
              debouncedUpdate();
            }
          } catch (parseError) {
            console.error("Failed to parse stream chunk:", parseError);
          }
        }
      }

      // Clear any pending debounced updates
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      // Finalize
      onUpdate(buildMessage(false));
    },
    [debounceMs, toolProcessors]
  );

  return { processStream };
}
