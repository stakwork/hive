export interface LearnMessage {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
}