import { ModelMessage } from "ai";

/**
 * Intelligently sanitize messages to ensure every tool-call has a corresponding tool-result.
 * For incomplete tool-calls (like learn_concept), this function will execute them to get results.
 * This prevents API errors when tool calls fail or don't complete properly during streaming.
 */
export async function sanitizeAndCompleteToolCalls(
  messages: ModelMessage[],
  swarmUrl: string,
  swarmApiKey: string
): Promise<ModelMessage[]> {
  // First pass: collect all tool call IDs that have results
  const toolCallIdsWithResults = new Set<string>();
  const toolResultMessages: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      toolResultMessages.push(msg);
      for (const item of msg.content) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((item as any).type === "tool-result" && (item as any).toolCallId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          toolCallIdsWithResults.add((item as any).toolCallId);
        }
      }
    }
  }

  // Second pass: find tool-calls without results and execute them
  const missingToolCalls: Array<{
    toolCallId: string;
    toolName: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any;
  }> = [];

  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const item of msg.content) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolCall = item as any;
        if (toolCall.type === "tool-call" && !toolCallIdsWithResults.has(toolCall.toolCallId)) {
          missingToolCalls.push({
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            input: toolCall.input,
          });
        }
      }
    }
  }

  // Execute missing tool calls
  const newToolResults: ModelMessage[] = [];

  for (const toolCall of missingToolCalls) {
    try {
      let output: unknown;

      if (toolCall.toolName === "learn_concept") {
        // Execute learn_concept
        const conceptId = toolCall.input?.conceptId;
        if (conceptId) {
          console.log(`🔧 Executing missing tool call: learn_concept(${conceptId})`);
          const res = await fetch(`${swarmUrl}/gitree/features/${encodeURIComponent(conceptId)}`, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "x-api-token": swarmApiKey,
            },
          });
          if (res.ok) {
            output = await res.json();
          } else {
            output = { error: "Feature not found" };
          }
        }
      } else if (toolCall.toolName === "list_concepts") {
        // Execute list_concepts
        console.log(`🔧 Executing missing tool call: list_concepts()`);
        const res = await fetch(`${swarmUrl}/gitree/features`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": swarmApiKey,
          },
        });
        if (res.ok) {
          output = await res.json();
        } else {
          output = { error: "Could not retrieve features" };
        }
      } else {
        // For other tool calls, we can't execute them here, so skip
        console.log(`⚠️ Cannot execute missing tool call: ${toolCall.toolName} (not implemented)`);
        continue;
      }

      // Add the tool result
      if (output !== undefined) {
        // Create a new tool result message for this specific tool call
        const toolResultMessage: ModelMessage = {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              output: { type: "json", value: output as any },
            },
          ],
        };
        newToolResults.push(toolResultMessage);
        toolCallIdsWithResults.add(toolCall.toolCallId);
      }
    } catch (error) {
      console.error(`❌ Error executing missing tool call ${toolCall.toolName}:`, error);
    }
  }

  // Third pass: rebuild messages array with completed tool calls
  const sanitized: ModelMessage[] = [];
  let newResultsInserted = false;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      // Check if this message has tool-calls
      const hasToolCalls = msg.content.some(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (item: any) => item.type === "tool-call"
      );

      if (hasToolCalls) {
        // Filter out tool-calls without results (that we couldn't execute)
        const filteredContent = msg.content.filter((item) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolCall = item as any;
          if (toolCall.type === "tool-call") {
            return toolCallIdsWithResults.has(toolCall.toolCallId);
          }
          return true; // Keep non-tool-call content
        });

        // Only include this message if it has content after filtering
        if (filteredContent.length > 0) {
          sanitized.push({ ...msg, content: filteredContent });

          // Check if the next message is a tool result
          const nextMsg = messages[i + 1];
          if (nextMsg?.role !== "tool" && newToolResults.length > 0 && !newResultsInserted) {
            // Insert new tool results right after this assistant message
            sanitized.push(...newToolResults);
            newResultsInserted = true;
          }
        }
      } else {
        // No tool-calls, keep as-is
        sanitized.push(msg);
      }
    } else if (msg.role === "tool") {
      // Keep existing tool results
      sanitized.push(msg);

      // If we have new tool results and haven't inserted them yet, add them after existing tool results
      if (newToolResults.length > 0 && !newResultsInserted) {
        sanitized.push(...newToolResults);
        newResultsInserted = true;
      }
    } else {
      // Other message types (user, system), keep as-is
      sanitized.push(msg);
    }
  }

  // If we still have new tool results that weren't inserted, add them at the end
  if (newToolResults.length > 0 && !newResultsInserted) {
    sanitized.push(...newToolResults);
  }

  return sanitized;
}
