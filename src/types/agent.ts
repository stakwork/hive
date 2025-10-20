import type { BaseStreamingMessage } from "./streaming";

/**
 * Agent streaming message type for frontend-only streaming display
 * These messages are ephemeral during streaming and converted to ChatMessage for storage
 */
export interface AgentStreamingMessage extends BaseStreamingMessage {
  role: "user" | "assistant";
  timestamp: Date;
  // Used to identify which ChatMessage this corresponds to after saving
  chatMessageId?: string;
}
