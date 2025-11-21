import { useCallback } from "react";
import type { BaseStreamingMessage, StreamProcessorConfig, StreamEvent, ToolCallStatus } from "@/types/streaming";
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
  config: StreamProcessorConfig = {},
) {
  const { debounceMs = DEFAULT_DEBOUNCE_MS, toolProcessors = {}, hiddenTools = [], hiddenToolTextIds = {} } = config;

  const processStream = useCallback(
    async (response: Response, messageId: string, onUpdate: (message: T) => void, additionalFields?: Partial<T>) => {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body reader available");
      }

      const textParts = new Map<string, string>();
      const textPartsOrder: string[] = []; // Track insertion order
      const reasoningParts = new Map<string, string>();
      const reasoningPartsOrder: string[] = []; // Track insertion order
      const toolCalls = new Map<string, InternalToolCall>();
      const toolCallsOrder: string[] = []; // Track insertion order
      const hiddenToolCallIds = new Map<string, string>(); // callId -> toolName
      const timeline: Array<{ type: "text" | "reasoning" | "toolCall"; id: string }> = []; // Unified timeline
      let error: string | undefined;

      // Track text part sequence to generate unique IDs when stream reuses IDs
      let textPartSequence = 0;
      const streamIdToUniqueId = new Map<string, string>(); // Map stream ID to our unique ID

      // Context for tool processors (can be used to pass state between processors)
      const processorContext: Record<string, unknown> = {};

      // Debounce mechanism
      let debounceTimer: NodeJS.Timeout | null = null;

      const buildMessage = (isStreaming: boolean): T => {
        // Use the tracked order to build arrays in insertion order
        const allTextParts = textPartsOrder.map((id) => ({
          id,
          content: textParts.get(id) || "",
        }));

        const allReasoningParts = reasoningPartsOrder.map((id) => ({
          id,
          content: reasoningParts.get(id) || "",
        }));

        const allToolCalls = toolCallsOrder
          .map((id) => {
            const call = toolCalls.get(id);
            return call ? { id, ...call } : null;
          })
          .filter((call): call is NonNullable<typeof call> => call !== null);

        // Build timeline in insertion order
        const timelineItems = timeline
          .map((item) => {
            if (item.type === "text") {
              const textPart = allTextParts.find((p) => p.id === item.id);
              return textPart ? { type: "text" as const, id: item.id, data: textPart } : null;
            } else if (item.type === "reasoning") {
              const reasoningPart = allReasoningParts.find((p) => p.id === item.id);
              return reasoningPart ? { type: "reasoning" as const, id: item.id, data: reasoningPart } : null;
            } else if (item.type === "toolCall") {
              const toolCall = allToolCalls.find((t) => t.id === item.id);
              return toolCall ? { type: "toolCall" as const, id: item.id, data: toolCall } : null;
            }
            return null;
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        return {
          id: messageId,
          content: textPartsOrder.map((id) => textParts.get(id) || "").join(""),
          isStreaming,
          isError: !!error,
          textParts: allTextParts,
          reasoningParts: allReasoningParts,
          toolCalls: allToolCalls,
          timeline: timelineItems,
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
              // Generate unique ID by combining stream ID with sequence number
              // This handles cases where AI SDK reuses the same ID for multiple text blocks
              const uniqueId = `${data.id}-${textPartSequence}`;
              textPartSequence++;

              // Map this stream ID to our unique ID
              streamIdToUniqueId.set(data.id, uniqueId);

              textParts.set(uniqueId, "");
              textPartsOrder.push(uniqueId);
              timeline.push({ type: "text", id: uniqueId });
            } else if (data.type === "text-delta") {
              // Use the mapped unique ID for this stream ID
              const uniqueId = streamIdToUniqueId.get(data.id);
              if (uniqueId) {
                textParts.set(uniqueId, (textParts.get(uniqueId) || "") + data.delta);
              }
            } else if (data.type === "reasoning-start") {
              reasoningParts.set(data.id, "");
              if (!reasoningPartsOrder.includes(data.id)) {
                reasoningPartsOrder.push(data.id);
                timeline.push({ type: "reasoning", id: data.id });
              }
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
                if (!toolCallsOrder.includes(data.toolCallId)) {
                  toolCallsOrder.push(data.toolCallId);
                  timeline.push({ type: "toolCall", id: data.toolCallId });
                }
                // Update immediately for tool starts (no debounce)
                updateMessage();
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
                  inputText: typeof data.input === "string" ? data.input : JSON.stringify(data.input, null, 2),
                  status: "input-available",
                });
                // Update immediately when tool input is ready
                updateMessage();
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
                  if (!textPartsOrder.includes(textId)) {
                    textPartsOrder.push(textId);
                    timeline.push({ type: "text", id: textId });
                  }
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
                  // Update immediately when tool output is ready
                  updateMessage();
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
            if (textParts.size > 0 || toolCalls.size > 0 || reasoningParts.size > 0 || error) {
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
    [debounceMs, toolProcessors, hiddenTools, hiddenToolTextIds],
  );

  return { processStream };
}
