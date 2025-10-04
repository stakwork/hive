import type { BaseStreamingMessage } from "./streaming";

export interface LearnMessage extends BaseStreamingMessage {
  role: "user" | "assistant";
  timestamp: Date;
}

export interface Learnings {
  prompts: string[];
  hints: string[];
}