import type { StreamTimelineItem, StreamToolCall } from "@/types/streaming";

/** A timeline entry to render: a text or reasoning part, or a run of back-to-back tool calls. */
export type TimelineChunk =
  | { type: "part"; key: string; item: StreamTimelineItem }
  | { type: "toolCalls"; key: string; toolCalls: StreamToolCall[] };

/**
 * Fold each run of consecutive tool calls into one chunk, keyed by its
 * first call so the chunk keeps its identity (and its open state) as
 * more calls stream in behind it.
 */
export function chunkTimeline(timeline: StreamTimelineItem[]): TimelineChunk[] {
  const chunks: TimelineChunk[] = [];
  for (const item of timeline) {
    if (item.type !== "toolCall") {
      chunks.push({ type: "part", key: `${item.type}-${item.id}`, item });
      continue;
    }
    const toolCall = item.data as StreamToolCall;
    const last = chunks[chunks.length - 1];
    if (last?.type === "toolCalls") last.toolCalls.push(toolCall);
    else chunks.push({ type: "toolCalls", key: `toolCalls-${item.id}`, toolCalls: [toolCall] });
  }
  return chunks;
}
