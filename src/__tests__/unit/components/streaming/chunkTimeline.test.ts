import { describe, expect, it } from "vitest";
import { chunkTimeline } from "@/components/streaming/chunkTimeline";
import type { StreamTimelineItem } from "@/types/streaming";

const text = (id: string): StreamTimelineItem => ({ type: "text", id, data: { id, content: `text ${id}` } });
const tool = (id: string): StreamTimelineItem => ({
  type: "toolCall",
  id,
  data: { id, toolName: `tool_${id}`, status: "output-available" },
});

describe("chunkTimeline", () => {
  it("folds consecutive tool calls into one chunk, keyed by the first call", () => {
    const chunks = chunkTimeline([text("a"), tool("1"), tool("2"), tool("3"), text("b")]);
    expect(chunks.map((c) => c.type)).toEqual(["part", "toolCalls", "part"]);
    const group = chunks[1];
    if (group.type !== "toolCalls") throw new Error("expected a tool-call chunk");
    expect(group.key).toBe("toolCalls-1");
    expect(group.toolCalls.map((tc) => tc.id)).toEqual(["1", "2", "3"]);
  });

  it("keeps runs apart when a part sits between them", () => {
    const chunks = chunkTimeline([tool("1"), text("a"), tool("2")]);
    expect(chunks.map((c) => (c.type === "toolCalls" ? c.toolCalls.length : c.item.id))).toEqual([1, "a", 1]);
  });

  it("keys parts by type and id", () => {
    const [part] = chunkTimeline([text("a")]);
    expect(part.key).toBe("text-a");
  });

  it("returns nothing for an empty timeline", () => {
    expect(chunkTimeline([])).toEqual([]);
  });
});
