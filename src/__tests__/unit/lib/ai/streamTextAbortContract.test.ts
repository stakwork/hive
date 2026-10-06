/**
 * Pins ai@7's `streamText` abort behaviour that the canvas Stop button is
 * built on (`runCanvasAgent`'s `onAbort`, the quick route's stopped-turn
 * persist and sub-agent sweep). If an SDK upgrade changes any of these,
 * that code has to change with it:
 *
 *   - `onAbort` gets only the steps that FINISHED; the interrupted step is
 *     left out (its text and tool calls exist only as streamed chunks).
 *   - An abort before any step finished rejects `result.steps`, while
 *     `consumeStream()` still settles.
 *   - After a finished step, `onFinish` fires too, AFTER `onAbort`.
 *   - A tool still executing at the abort is awaited before the stream
 *     settles — so every dispatch it made has landed by then — and its
 *     result never streams.
 *
 * Every abort is fired from inside a callback, never on a timer.
 */
import { describe, test, expect } from "vitest";
import { streamText, stepCountIs, tool, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, reasoning: 0 },
};

type Chunk = Record<string, unknown> & { type: string };

const text = (id: string, deltas: string[]): Chunk[] => [
  { type: "text-start", id },
  ...deltas.map((delta) => ({ type: "text-delta", id, delta })),
  { type: "text-end", id },
];

const toolCall = (id: string, input: object): Chunk[] => [
  { type: "tool-input-start", id, toolName: "work" },
  { type: "tool-input-delta", id, delta: JSON.stringify(input) },
  { type: "tool-input-end", id },
  { type: "tool-call", toolCallId: id, toolName: "work", input: JSON.stringify(input) },
];

/** One mock model step per entry; a step with a tool call finishes as "tool-calls". */
function model(steps: Chunk[][]) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const body = steps[call++];
      const finishReason = body.some((c) => c.type === "tool-call")
        ? { unified: "tool-calls", raw: "tool_calls" }
        : { unified: "stop", raw: "stop" };
      const chunks = [
        { type: "stream-start", warnings: [] },
        { type: "response-metadata", id: `step-${call}`, timestamp: new Date(0), modelId: "mock" },
        ...body,
        { type: "finish", finishReason, usage },
      ];
      return { stream: simulateReadableStream({ chunks: chunks as never, chunkDelayInMs: 1 }) };
    },
  });
}

function run(steps: Chunk[][], opts: { abortOnText?: string; toolMs?: number } = {}) {
  const controller = new AbortController();
  const events: string[] = [];
  const chunks: string[] = [];
  let abortSteps: number | undefined;
  let toolSawAbort = false;
  let toolFinished = false;

  const work = tool({
    description: "work",
    inputSchema: z.object({ q: z.string() }),
    execute: async ({ q }, { abortSignal }) => {
      if (q === "stop-here") controller.abort();
      await new Promise((r) => setTimeout(r, opts.toolMs ?? 0));
      toolSawAbort = !!abortSignal?.aborted;
      toolFinished = true;
      return { done: q };
    },
  });

  const result = streamText({
    model: model(steps),
    tools: { work },
    prompt: "go",
    stopWhen: stepCountIs(5),
    abortSignal: controller.signal,
    onChunk: ({ chunk }) => {
      chunks.push(chunk.type);
      if (chunk.type === "text-delta" && chunk.text === opts.abortOnText) controller.abort();
    },
    onFinish: () => {
      events.push("finish");
    },
    onAbort: ({ steps: finished }) => {
      events.push("abort");
      abortSteps = finished.length;
    },
  });

  return {
    result,
    events,
    chunks,
    abortSteps: () => abortSteps,
    toolSawAbort: () => toolSawAbort,
    toolFinished: () => toolFinished,
  };
}

describe("ai@7 streamText abort contract (canvas Stop)", () => {
  test("an abort before any step finished: onAbort gets no steps, steps rejects, consumeStream settles", async () => {
    const r = run([text("t1", ["Hel", "lo", " there"])], { abortOnText: "lo" });

    await expect(r.result.consumeStream()).resolves.toBeUndefined();
    await expect(r.result.steps).rejects.toBeDefined();
    expect(r.events).toEqual(["abort"]);
    expect(r.abortSteps()).toBe(0);
  });

  test("an abort while a tool runs: the tool is awaited, onAbort gets no steps, its result never streams", async () => {
    const r = run([[...text("t1", ["Checking. "]), ...toolCall("c1", { q: "stop-here" })], text("t2", ["done"])], {
      toolMs: 20,
    });

    await r.result.consumeStream();

    expect(r.toolFinished()).toBe(true);
    expect(r.toolSawAbort()).toBe(true);
    expect(r.chunks).toContain("tool-call");
    expect(r.chunks).not.toContain("tool-result");
    expect(r.events).toEqual(["abort"]);
    expect(r.abortSteps()).toBe(0);
  });

  test("an abort after a finished step: onAbort gets that step, then onFinish fires too", async () => {
    const r = run([toolCall("c1", { q: "first" }), text("t2", ["The ", "answer ", "is"])], {
      abortOnText: "answer ",
    });

    await r.result.consumeStream();

    expect(r.events).toEqual(["abort", "finish"]);
    expect(r.abortSteps()).toBe(1);
    const steps = await r.result.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0].toolResults).toHaveLength(1);
  });
});
