import { describe, it, expect, vi } from "vitest";
import { applyCanvasAssistantStream } from "@/app/org/[githubLogin]/_state/applyCanvasAssistantStream";
import type { StreamTimelineItem } from "@/types/streaming";

function run(timeline: StreamTimelineItem[], messageId = "live-1") {
  const replaceAssistantStream = vi.fn();
  const setActiveToolCalls = vi.fn();
  applyCanvasAssistantStream({
    conversationId: "slot-1",
    messageId,
    updatedMessage: { timeline },
    setActiveToolCalls,
    replaceAssistantStream,
  });
  return replaceAssistantStream.mock.calls[0] as [
    string,
    string,
    Array<{
      id: string;
      content: string;
      toolCalls?: Array<{ toolName: string }>;
      timeline?: Array<{ type: string; data: { content?: string } }>;
    }>,
  ];
}

describe("applyCanvasAssistantStream", () => {
  it("emits a reasoning row between flushed text and the next text", () => {
    const [, prefix, rows] = run([
      { type: "text", id: "t1", data: { id: "t1", content: "Hello" } },
      { type: "reasoning", id: "r1", data: { id: "r1", content: "thinking" } },
      { type: "text", id: "t2", data: { id: "t2", content: "World" } },
    ]);

    expect(prefix).toBe("live-1");
    expect(rows.map((r) => r.content)).toEqual(["Hello", "", "World"]);
    expect(rows[1].timeline?.[0].type).toBe("reasoning");
    expect(rows[1].timeline?.[0].data.content).toBe("thinking");
    expect(rows.every((r) => r.id.startsWith("live-1-"))).toBe(true);
  });

  it("flushes a pending tool run before a reasoning item", () => {
    const [, , rows] = run([
      {
        type: "toolCall",
        id: "tc-1",
        data: {
          id: "tc-1",
          toolName: "web_search",
          status: "output-available",
          output: { ok: true },
        },
      },
      { type: "reasoning", id: "r1", data: { id: "r1", content: "now I know" } },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].toolCalls?.[0].toolName).toBe("web_search");
    expect(rows[1].timeline?.[0].type).toBe("reasoning");
  });

  it("does not use the persisted turnId as the replace prefix", () => {
    const [, prefix, rows] = run(
      [{ type: "text", id: "t1", data: { id: "t1", content: "hi" } }],
      "1750000000001",
    );
    expect(prefix).not.toMatch(/-u$/);
    expect(rows[0].id.startsWith("1750000000001-")).toBe(true);
    expect(rows[0].id.startsWith("turn-")).toBe(false);
  });
});
