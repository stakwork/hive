import { useCallback } from "react";
import type { LearnMessage } from "@/types/learn";

export function useStreamProcessor() {
  const processStream = useCallback(
    async (response: Response, messageId: string, onUpdate: (message: LearnMessage) => void) => {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body reader available");
      }

      const textParts = new Map<string, string>();
      const reasoningParts = new Map<string, string>();
      const toolCalls = new Map<
        string,
        {
          toolName: string;
          input?: unknown;
          inputText?: string;
          output?: unknown;
          status:
            | "input-start"
            | "input-delta"
            | "input-available"
            | "input-error"
            | "output-available"
            | "output-error";
          errorText?: string;
        }
      >();
      let error: string | undefined;
      let finalAnswer: string | undefined;

      const updateMessage = () => {
        // Build text parts array with final answer at the end
        const allTextParts = Array.from(textParts.entries()).map(([id, content]) => ({
          id,
          content,
        }));

        if (finalAnswer) {
          allTextParts.push({
            id: "final-answer",
            content: finalAnswer,
          });
        }

        onUpdate({
          id: messageId,
          content: Array.from(textParts.values()).join("") + (finalAnswer || ""),
          role: "assistant",
          timestamp: new Date(),
          isStreaming: true,
          textParts: allTextParts,
          reasoningParts: Array.from(reasoningParts.entries()).map(([id, content]) => ({ id, content })),
          toolCalls: Array.from(toolCalls.entries()).map(([id, call]) => ({
            id,
            ...call,
          })),
          error,
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.trim().startsWith("data:"));

        for (const line of lines) {
          const jsonStr = line.replace(/^data:\s*/, "").trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const data = JSON.parse(jsonStr);

            if (data.type === "text-start") {
              textParts.set(data.id, "");
            } else if (data.type === "text-delta") {
              textParts.set(data.id, (textParts.get(data.id) || "") + data.delta);
            } else if (data.type === "reasoning-start") {
              reasoningParts.set(data.id, "");
            } else if (data.type === "reasoning-delta") {
              reasoningParts.set(data.id, (reasoningParts.get(data.id) || "") + data.delta);
            } else if (data.type === "tool-input-start") {
              toolCalls.set(data.toolCallId, {
                toolName: data.toolName,
                status: "input-start",
              });
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
              const existing = toolCalls.get(data.toolCallId);
              if (existing) {
                // Special handling for final_answer - store separately to show at the end
                if (existing.toolName === "final_answer") {
                  finalAnswer = typeof data.output === "string"
                    ? data.output
                    : (data.output as { answer?: string })?.answer || JSON.stringify(data.output);

                  // Remove the tool call so it doesn't show as a bubble
                  toolCalls.delete(data.toolCallId);
                } else {
                  toolCalls.set(data.toolCallId, {
                    ...existing,
                    output: data.output,
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

            updateMessage();
          } catch (parseError) {
            console.error("Failed to parse stream chunk:", parseError);
          }
        }
      }

      // Finalize - build final text parts with final answer at the end
      const finalTextParts = Array.from(textParts.entries()).map(([id, content]) => ({
        id,
        content,
      }));

      if (finalAnswer) {
        finalTextParts.push({
          id: "final-answer",
          content: finalAnswer,
        });
      }

      onUpdate({
        id: messageId,
        content: Array.from(textParts.values()).join("") + (finalAnswer || ""),
        role: "assistant",
        timestamp: new Date(),
        isStreaming: false,
        isError: !!error,
        textParts: finalTextParts,
        reasoningParts: Array.from(reasoningParts.entries()).map(([id, content]) => ({ id, content })),
        toolCalls: Array.from(toolCalls.entries()).map(([id, call]) => ({
          id,
          ...call,
        })),
        error,
      });
    },
    [],
  );

  return { processStream };
}
