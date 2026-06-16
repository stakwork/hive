/**
 * Unit tests for `timelineFromToolCalls` (canvasChatStore).
 *
 * This helper fixes the reload bug where a canvas chat tool-call row
 * persists only `toolCalls` (no `timeline`) and therefore rendered
 * nothing on reload/share/live-sync. The helper synthesizes the render
 * `timeline` from the persisted `toolCalls` so reloaded tool calls render
 * identically to live ones.
 */

import { describe, it, expect } from "vitest";
import {
  timelineFromToolCalls,
  type ToolCall,
} from "@/app/org/[githubLogin]/_state/canvasChatStore";

describe("timelineFromToolCalls", () => {
  it("synthesizes a toolCall timeline item per tool call", () => {
    const toolCalls: ToolCall[] = [
      {
        id: "tc-1",
        toolName: "read_initiative",
        input: { id: "init-1" },
        output: { name: "Init A" },
        status: "output-available",
      },
    ];

    const timeline = timelineFromToolCalls(toolCalls);

    expect(timeline).toHaveLength(1);
    expect(timeline[0].type).toBe("toolCall");
    expect(timeline[0].id).toBe("tc-1");
    expect(timeline[0].data).toMatchObject({
      id: "tc-1",
      toolName: "read_initiative",
      input: { id: "init-1" },
      output: { name: "Init A" },
      status: "output-available",
    });
  });

  it("derives inputText from a non-string input via JSON", () => {
    const [item] = timelineFromToolCalls([
      { id: "tc", toolName: "t", input: { a: 1 }, status: "input-available" },
    ]);

    expect((item.data as { inputText?: string }).inputText).toBe(
      JSON.stringify({ a: 1 }, null, 2),
    );
  });

  it("passes a string input through as inputText verbatim", () => {
    const [item] = timelineFromToolCalls([
      { id: "tc", toolName: "t", input: "hello", status: "input-available" },
    ]);

    expect((item.data as { inputText?: string }).inputText).toBe("hello");
  });

  it("leaves inputText undefined when there is no input", () => {
    const [item] = timelineFromToolCalls([
      { id: "tc", toolName: "t", status: "input-available" },
    ]);

    expect((item.data as { inputText?: string }).inputText).toBeUndefined();
  });

  it("preserves errorText and error status", () => {
    const [item] = timelineFromToolCalls([
      {
        id: "tc",
        toolName: "t",
        status: "output-error",
        errorText: "Tool call failed",
      },
    ]);

    expect(item.data).toMatchObject({
      status: "output-error",
      errorText: "Tool call failed",
    });
  });

  it("preserves order across multiple tool calls", () => {
    const timeline = timelineFromToolCalls([
      { id: "a", toolName: "t1", status: "output-available" },
      { id: "b", toolName: "t2", status: "output-available" },
    ]);

    expect(timeline.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("returns an empty array for no tool calls", () => {
    expect(timelineFromToolCalls([])).toEqual([]);
  });
});
