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
        if ("type" in item && item.type === "tool-result" && "toolCallId" in item) {
          toolCallIdsWithResults.add(item.toolCallId);
        }
      }
    }
  }

  // Second pass: find tool-calls without results and execute them
  const missingToolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }> = [];

  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if ("type" in item && item.type === "tool-call" && "toolCallId" in item && "toolName" in item) {
          if (!toolCallIdsWithResults.has(item.toolCallId)) {
            missingToolCalls.push({
              toolCallId: item.toolCallId,
              toolName: item.toolName,
              input: "input" in item ? item.input : undefined,
            });
          }
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
        const input = toolCall.input as { conceptId?: string } | undefined;
        const conceptId = input?.conceptId;
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
              output: { type: "json", value: output as unknown },
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
  // We need to insert new tool results right after their corresponding tool-call messages
  const sanitized: ModelMessage[] = [];

  // Build a map of toolCallId -> new tool result message for quick lookup
  const newResultsByCallId = new Map<string, ModelMessage>();
  for (const resultMsg of newToolResults) {
    if (Array.isArray(resultMsg.content)) {
      for (const item of resultMsg.content) {
        if ("type" in item && item.type === "tool-result" && "toolCallId" in item) {
          newResultsByCallId.set(item.toolCallId, resultMsg);
        }
      }
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      // Check if this message has tool-calls
      const hasToolCalls = msg.content.some(
        (item) => "type" in item && item.type === "tool-call"
      );

      if (hasToolCalls) {
        // Filter out tool-calls without results (that we couldn't execute)
        const filteredContent = msg.content.filter((item) => {
          if ("type" in item && item.type === "tool-call" && "toolCallId" in item) {
            return toolCallIdsWithResults.has(item.toolCallId);
          }
          return true; // Keep non-tool-call content
        });

        // Only include this message if it has content after filtering
        if (filteredContent.length > 0) {
          sanitized.push({ ...msg, content: filteredContent });

          // Check if any of the tool calls in this message have new results we need to insert
          const toolCallsInMessage = filteredContent
            .filter((item) => "type" in item && item.type === "tool-call" && "toolCallId" in item)
            .map((item) => "toolCallId" in item ? item.toolCallId as string : "");

          // Check if the next message is already a tool result for these calls
          const nextMsg = messages[i + 1];
          const nextIsToolResult = nextMsg?.role === "tool";

          // If there's no tool result message immediately after, insert any new results
          if (!nextIsToolResult) {
            for (const toolCallId of toolCallsInMessage) {
              const newResult = newResultsByCallId.get(toolCallId);
              if (newResult && !sanitized.includes(newResult)) {
                sanitized.push(newResult);
              }
            }
          }
        }
      } else {
        // No tool-calls, keep as-is
        sanitized.push(msg);
      }
    } else if (msg.role === "tool") {
      // Keep existing tool results
      sanitized.push(msg);
    } else {
      // Other message types (user, system), keep as-is
      sanitized.push(msg);
    }
  }

  return sanitized;
}
