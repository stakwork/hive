/**
 * Maps raw stored conversation messages from the API into the local
 * Message shape used by DashboardChat / RecentChatsPopup.
 */

export interface MappedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  imageData?: string;
  toolCalls?: unknown[];
}

export function mapConversationMessages(rawMessages: unknown[]): MappedMessage[] {
  return (Array.isArray(rawMessages) ? rawMessages : [])
    .filter((m: any) => m.role === "user" || m.role === "assistant")
    .map((m: any, idx: number) => ({
      id: m.id || `loaded-${idx}`,
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : "",
      timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
      imageData: m.imageData,
      toolCalls: m.toolCalls,
    }));
}
