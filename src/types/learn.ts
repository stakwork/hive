export interface LearnMessage {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
  isError?: boolean;
  isStreaming?: boolean;
  textParts?: StreamTextPart[];
  toolCalls?: StreamToolCall[];
  reasoningParts?: StreamReasoningPart[];
  error?: string;
}

export interface StreamTextPart {
  id: string;
  content: string;
}

export interface StreamReasoningPart {
  id: string;
  content: string;
}

export interface StreamToolCall {
  id: string;
  toolName: string;
  input?: unknown;
  inputText?: string;
  output?: unknown;
  status: "input-start" | "input-delta" | "input-available" | "input-error" | "output-available" | "output-error";
  errorText?: string;
  providerExecuted?: boolean;
  dynamic?: boolean;
}

export interface Learnings {
  prompts: string[];
  hints: string[];
}