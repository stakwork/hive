// Core streaming types for AI SDK integration

export type StreamEventType =
  | "text-start"
  | "text-delta"
  | "reasoning-start"
  | "reasoning-delta"
  | "tool-input-start"
  | "tool-input-delta"
  | "tool-input-available"
  | "tool-input-error"
  | "tool-output-available"
  | "tool-output-error"
  | "error";

export type ToolCallStatus =
  | "input-start"
  | "input-delta"
  | "input-available"
  | "input-error"
  | "output-available"
  | "output-error";

export interface BaseStreamEvent {
  type: StreamEventType;
}

export interface TextStartEvent extends BaseStreamEvent {
  type: "text-start";
  id: string;
}

export interface TextDeltaEvent extends BaseStreamEvent {
  type: "text-delta";
  id: string;
  delta: string;
}

export interface ReasoningStartEvent extends BaseStreamEvent {
  type: "reasoning-start";
  id: string;
}

export interface ReasoningDeltaEvent extends BaseStreamEvent {
  type: "reasoning-delta";
  id: string;
  delta: string;
}

export interface ToolInputStartEvent extends BaseStreamEvent {
  type: "tool-input-start";
  toolCallId: string;
  toolName: string;
}

export interface ToolInputDeltaEvent extends BaseStreamEvent {
  type: "tool-input-delta";
  toolCallId: string;
  inputTextDelta: string;
}

export interface ToolInputAvailableEvent extends BaseStreamEvent {
  type: "tool-input-available";
  toolCallId: string;
  input: unknown;
}

export interface ToolInputErrorEvent extends BaseStreamEvent {
  type: "tool-input-error";
  toolCallId: string;
  input: unknown;
  errorText: string;
}

export interface ToolOutputAvailableEvent extends BaseStreamEvent {
  type: "tool-output-available";
  toolCallId: string;
  output: unknown;
}

export interface ToolOutputErrorEvent extends BaseStreamEvent {
  type: "tool-output-error";
  toolCallId: string;
  errorText: string;
}

export interface ErrorEvent extends BaseStreamEvent {
  type: "error";
  errorText: string;
}

export type StreamEvent =
  | TextStartEvent
  | TextDeltaEvent
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ToolInputStartEvent
  | ToolInputDeltaEvent
  | ToolInputAvailableEvent
  | ToolInputErrorEvent
  | ToolOutputAvailableEvent
  | ToolOutputErrorEvent
  | ErrorEvent;

// Generic streaming message structure
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
  status: ToolCallStatus;
  errorText?: string;
}

export interface BaseStreamingMessage {
  id: string;
  content: string;
  isStreaming?: boolean;
  isError?: boolean;
  textParts?: StreamTextPart[];
  reasoningParts?: StreamReasoningPart[];
  toolCalls?: StreamToolCall[];
  error?: string;
}

// Tool processor function type
export type ToolProcessor<T = unknown> = (output: unknown, context?: Record<string, unknown>) => T;

export interface ToolProcessorMap {
  [toolName: string]: ToolProcessor;
}

// Stream processor configuration
export interface StreamProcessorConfig {
  debounceMs?: number;
  toolProcessors?: ToolProcessorMap;
  /**
   * Tools that should be hidden from UI and have their output added as text parts
   * Example: ["final_answer"]
   */
  hiddenTools?: string[];
  /**
   * ID to use for hidden tool outputs when adding to text parts
   * Example: { final_answer: "final-answer" }
   */
  hiddenToolTextIds?: Record<string, string>;
}
