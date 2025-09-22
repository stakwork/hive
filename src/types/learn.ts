export interface LearnMessage {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
  isError?: boolean;
}

export interface Learnings {
  prompts: string[];
  hints: string[];
}