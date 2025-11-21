import type { BaseStreamingMessage } from "./streaming";

export interface LearnMessage extends BaseStreamingMessage {
  role: "user" | "assistant";
  timestamp: Date;
  ref_id?: string;
}

export interface Learnings {
  prompts: string[];
  hints: string[];
}
