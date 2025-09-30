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
      const finalAnswerToolIds = new Set<string>();
      let webSearchResults: Array<{ url: string; title?: string }> = [];

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
              // Track final_answer but don't show as a tool bubble
              if (data.toolName === "final_answer") {
                finalAnswerToolIds.add(data.toolCallId);
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
              // Skip final_answer tool
              if (!finalAnswerToolIds.has(data.toolCallId)) {
                const existing = toolCalls.get(data.toolCallId);
                if (existing) {
                  toolCalls.set(data.toolCallId, {
                    ...existing,
                    input: data.input,
                    status: "input-available",
                  });
                }
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

              // Capture web search results
              if (existing?.toolName === "web_search" && Array.isArray(data.output)) {
                webSearchResults = data.output.map((result: { url: string; title?: string }) => ({
                  url: result.url,
                  title: result.title,
                }));
              }

              // Final output available - ensure final_answer is cleaned up
              if (finalAnswerToolIds.has(data.toolCallId)) {
                let answer = typeof data.output === "string"
                  ? data.output
                  : (data.output as { answer?: string })?.answer || JSON.stringify(data.output);

                // Clean up XML tags if present and convert citations to links
                if (typeof answer === "string") {
                  answer = answer
                    .replace(/<function_calls>\s*/gi, "")
                    .replace(/<\/function_calls>\s*/gi, "")
                    .replace(/<invoke[^>]*>\s*/gi, "")
                    .replace(/<\/invoke>\s*/gi, "")
                    .replace(/<parameter[^>]*>/gi, "")
                    .replace(/<\/parameter>\s*/gi, "")
                    .trim();

                  // Convert <cite index="X-Y">text</cite> to markdown links
                  answer = answer.replace(/<cite index="(\d+)-\d+">(.*?)<\/cite>/g, (_match: string, index: string, text: string) => {
                    const resultIndex = parseInt(index) - 1; // Convert to 0-indexed
                    if (webSearchResults[resultIndex]) {
                      const result = webSearchResults[resultIndex];
                      return `[${text}](${result.url})`;
                    }
                    return text;
                  });
                }

                // Set the final cleaned answer
                textParts.set("final-answer", answer);
                finalAnswer = answer;
              } else if (existing) {
                toolCalls.set(data.toolCallId, {
                  ...existing,
                  output: data.output,
                  status: "output-available",
                });
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
            if (textParts.size > 0 || toolCalls.size > 0 || reasoningParts.size > 0 || finalAnswer || error) {
              updateMessage();
            }
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
