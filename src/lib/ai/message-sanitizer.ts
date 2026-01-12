import { ModelMessage } from "ai";

/**
 * Intelligently sanitize messages to ensure every tool-call has a corresponding tool-result.
 * For incomplete tool-calls (like learn_concept), this function will execute them to get results.
 * This prevents API errors when tool calls fail or don't complete properly during streaming.
 */
export async function sanitizeAndCompleteToolCalls(
  messages: ModelMessage[],
  swarmUrl: string,
  swarmApiKey: string,
): Promise<ModelMessage[]> {
  // First pass: collect all tool call IDs that have results
  const toolCallIdsWithResults = new Set<string>();
  const toolResultMessages: ModelMessage[] = [];

  // Also collect all tool call IDs for comparison
  const allToolCallIds: Array<{ id: string; toolName: string; messageIndex: number }> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      toolResultMessages.push(msg);
      for (const item of msg.content) {
        if ((item as any).type === "tool-result" && (item as any).toolCallId) {
          toolCallIdsWithResults.add((item as any).toolCallId);
        }
      }
    }
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if ((item as any).type === "tool-call" && (item as any).toolCallId) {
          allToolCallIds.push({
            id: (item as any).toolCallId,
            toolName: (item as any).toolName,
            messageIndex: i,
          });
        }
      }
    }
  }

  // Second pass: find tool-calls without results and execute them
  const missingToolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: any;
  }> = [];

  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const item of msg.content) {
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

  // Log diagnostic info if there are missing tool calls
  if (missingToolCalls.length > 0) {
    console.log(`🔧 [message-sanitizer] Found ${missingToolCalls.length} orphaned tool call(s):`, {
      totalMessages: messages.length,
      totalToolCalls: allToolCallIds.length,
      totalToolResults: toolCallIdsWithResults.size,
      orphanedCalls: missingToolCalls.map((tc) => ({
        id: tc.toolCallId,
        tool: tc.toolName,
        inputKeys: Object.keys(tc.input || {}),
      })),
      allToolCalls: allToolCallIds,
    });
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
        } else {
          output = { error: "Missing conceptId parameter" };
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
        // For other tool calls, we can't execute them - create a dummy result
        // to satisfy the API requirement that every tool_use has a tool_result
        console.log(`⚠️ Creating placeholder result for unexecutable tool call: ${toolCall.toolName}`);
        output = { error: `Tool execution was interrupted. Please try again.` };
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
              output: { type: "json", value: output as any },
            },
          ],
        };
        newToolResults.push(toolResultMessage);
        toolCallIdsWithResults.add(toolCall.toolCallId);
      }
    } catch (error) {
      console.error(`❌ Error executing missing tool call ${toolCall.toolName}:`, error);
      // Still create a placeholder result to satisfy the API requirement
      const toolResultMessage: ModelMessage = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            output: { type: "json", value: { error: "Tool execution failed" } as any },
          },
        ],
      };
      newToolResults.push(toolResultMessage);
      toolCallIdsWithResults.add(toolCall.toolCallId);
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
        const result = item as any;
        if (result.type === "tool-result" && result.toolCallId) {
          newResultsByCallId.set(result.toolCallId, resultMsg);
        }
      }
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      // Check if this message has tool-calls
      const hasToolCalls = msg.content.some((item: any) => item.type === "tool-call");

      if (hasToolCalls) {
        // Filter out tool-calls without results (that we couldn't execute)
        const filteredContent = msg.content.filter((item) => {
          const toolCall = item as any;
          if (toolCall.type === "tool-call") {
            return toolCallIdsWithResults.has(toolCall.toolCallId);
          }
          return true; // Keep non-tool-call content
        });

        // Only include this message if it has content after filtering
        if (filteredContent.length > 0) {
          sanitized.push({ ...msg, content: filteredContent });

          // Check if any of the tool calls in this message have new results we need to insert
          const toolCallsInMessage = filteredContent
            .filter((item) => (item as any).type === "tool-call")
            .map((item) => (item as any).toolCallId);

          // Check if the next message is already a tool result for these calls
          const nextMsg = messages[i + 1];
          const nextIsToolResult = nextMsg?.role === "tool";

          // Collect tool call IDs that are covered by the next tool result message
          const coveredByNextResult = new Set<string>();
          if (nextIsToolResult && Array.isArray(nextMsg.content)) {
            for (const item of nextMsg.content) {
              const result = item as any;
              if (result.type === "tool-result" && result.toolCallId) {
                coveredByNextResult.add(result.toolCallId);
              }
            }
          }

          // Insert new results for tool calls not covered by the existing next message
          for (const toolCallId of toolCallsInMessage) {
            if (!coveredByNextResult.has(toolCallId)) {
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
      // Normalize tool results - ensure output is in the correct format
      // The AI SDK expects output to be an object { type: "json", value: ... }
      // but UIMessages from frontend may have raw string outputs
      if (Array.isArray(msg.content)) {
        const normalizedContent = msg.content.map((item) => {
          const toolResult = item as any;
          if (toolResult.type === "tool-result" && toolResult.output !== undefined) {
            // Check if output is a raw string or primitive instead of object format
            if (
              typeof toolResult.output === "string" ||
              typeof toolResult.output === "number" ||
              typeof toolResult.output === "boolean"
            ) {
              console.log(`🔧 [message-sanitizer] Normalizing string output for tool: ${toolResult.toolName}`);
              return {
                ...toolResult,
                output: { type: "json", value: toolResult.output },
              };
            }
            // Check if output is an object but not in the expected format
            if (typeof toolResult.output === "object" && toolResult.output !== null) {
              // If it doesn't have the { type, value } structure, wrap it
              if (!("type" in toolResult.output && "value" in toolResult.output)) {
                console.log(`🔧 [message-sanitizer] Wrapping object output for tool: ${toolResult.toolName}`);
                return {
                  ...toolResult,
                  output: { type: "json", value: toolResult.output },
                };
              }
            }
          }
          return item;
        });
        sanitized.push({ ...msg, content: normalizedContent });
      } else {
        sanitized.push(msg);
      }
    } else {
      // Other message types (user, system), keep as-is
      sanitized.push(msg);
    }
  }

  // Log summary if any repairs were made
  if (newToolResults.length > 0) {
    console.log(`✅ [message-sanitizer] Repaired ${newToolResults.length} orphaned tool call(s):`, {
      originalMessageCount: messages.length,
      sanitizedMessageCount: sanitized.length,
      insertedResults: newToolResults.map((r) => {
        const content = Array.isArray(r.content) ? r.content[0] : null;
        return {
          toolCallId: (content as any)?.toolCallId,
          toolName: (content as any)?.toolName,
        };
      }),
    });
  }

  return sanitized;
}
