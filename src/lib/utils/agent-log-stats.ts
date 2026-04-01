export interface ToolCallContent {
  type: "tool-call";
  toolCallId?: string;
  toolName: string;
  input?: unknown;
}

export interface ToolResultContent {
  type: "tool-result";
  toolCallId?: string;
  toolName?: string;
  output?: { type: string; value: string } | string;
}

export interface OpenAIToolCall {
  id?: string;
  type: "function";
  function: { name: string; arguments?: string };
}

export interface ParsedMessage {
  role: string;
  content?: string | Array<ToolCallContent | ToolResultContent | { type: string; text?: string }>;
  reasoning?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface AgentLogStats {
  totalMessages: number;
  estimatedTokens: number;
  totalToolCalls: number;
  toolFrequency: Record<string, number>;
  bashFrequency: Record<string, number>;
  developerShellFrequency: Record<string, number>;
}

export interface AgentLogStatsResult {
  conversation: ParsedMessage[];
  stats: AgentLogStats;
}

export function isValidMessage(msg: unknown): msg is ParsedMessage {
  return (
    msg != null &&
    typeof msg === "object" &&
    "role" in msg &&
    typeof (msg as ParsedMessage).role === "string"
  );
}

export function parseAgentLogStats(content: string): AgentLogStatsResult {
  const emptyResult: AgentLogStatsResult = {
    conversation: [],
    stats: {
      totalMessages: 0,
      estimatedTokens: 0,
      totalToolCalls: 0,
      toolFrequency: {},
      bashFrequency: {},
      developerShellFrequency: {},
    },
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return emptyResult;
  }

  // Handle bare array or { messages: [...] } wrapper
  let candidates: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    candidates = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).messages)) {
    candidates = (parsed as Record<string, unknown>).messages as unknown[];
  }

  if (!candidates || candidates.length === 0) return emptyResult;

  const conversation = candidates.filter(isValidMessage);
  if (conversation.length === 0) return emptyResult;

  // Token estimation: total chars across role + content fields ÷ 4
  let totalChars = 0;
  for (const msg of conversation) {
    totalChars += msg.role.length;
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      totalChars += JSON.stringify(msg.content).length;
    }
    if (typeof msg.reasoning === "string") {
      totalChars += msg.reasoning.length;
    }
  }

  // Tool call counting
  const toolFrequency: Record<string, number> = {};
  const bashFrequency: Record<string, number> = {};
  const developerShellFrequency: Record<string, number> = {};
  let totalToolCalls = 0;

  for (const msg of conversation) {
    if (msg.role !== "assistant") continue;

    // AI SDK format: content[].type === "tool-call"
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part != null && typeof part === "object" && part.type === "tool-call") {
          const tc = part as ToolCallContent;
          if (tc.toolName) {
            toolFrequency[tc.toolName] = (toolFrequency[tc.toolName] ?? 0) + 1;
            totalToolCalls++;
            if (tc.toolName === "bash") {
              const cmd = (tc.input as { command?: string })?.command?.trim().split(" ")[0];
              if (cmd) bashFrequency[cmd] = (bashFrequency[cmd] ?? 0) + 1;
            }
            if (tc.toolName === "developer__shell") {
              const cmd = (tc.input as { command?: string })?.command?.trim().split(" ")[0];
              if (cmd) developerShellFrequency[cmd] = (developerShellFrequency[cmd] ?? 0) + 1;
            }
          }
        }
      }
    }

    // OpenAI format: tool_calls[].type === "function"
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc != null && typeof tc === "object" && tc.type === "function" && tc.function?.name) {
          const name = tc.function.name;
          toolFrequency[name] = (toolFrequency[name] ?? 0) + 1;
          totalToolCalls++;
          if (name === "bash") {
            try {
              const args = JSON.parse(tc.function.arguments ?? "{}") as { command?: string };
              const cmd = args.command?.trim().split(" ")[0];
              if (cmd) bashFrequency[cmd] = (bashFrequency[cmd] ?? 0) + 1;
            } catch {
              // malformed arguments — skip silently
            }
          }
          if (name === "developer__shell") {
            try {
              const args = JSON.parse(tc.function.arguments ?? "{}") as { command?: string };
              const cmd = args.command?.trim().split(" ")[0];
              if (cmd) developerShellFrequency[cmd] = (developerShellFrequency[cmd] ?? 0) + 1;
            } catch { /* skip */ }
          }
        }
      }
    }
  }

  return {
    conversation,
    stats: {
      totalMessages: conversation.length,
      estimatedTokens: Math.ceil(totalChars / 4),
      totalToolCalls,
      toolFrequency,
      bashFrequency,
      developerShellFrequency,
    },
  };
}
