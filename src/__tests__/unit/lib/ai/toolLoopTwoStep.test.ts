/**
 * Real in-process 2-step tool loop against ai@7's MockLanguageModelV4.
 *
 * This is a REGRESSION GUARD for canvas turn persistence. The AI SDK's
 * `result.response.messages` only carries the LAST step's messages, so a
 * persist path built on it silently drops every tool call/result from
 * earlier steps. `messagesFromSteps(result.steps)` walks ALL steps and is
 * the only correct source. We prove that here with a genuine two-step
 * loop (step 1 = tool call, step 2 = follow-up text) rather than fixtures.
 */
import { describe, test, expect } from "vitest";
import { streamText, stepCountIs, tool, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { messagesFromSteps } from "@/services/canvas-turn-persistence";

// Distinct per-step usage so the "sum" assertion below is meaningful:
// if the SDK ever returned a single step's usage as the total, these
// numbers would not add up.
// ai@7 (LanguageModelV4) nests provider usage: inputTokens/outputTokens are
// objects with a `total`, not bare numbers. The SDK flattens these back to
// `step.usage.inputTokens` / `.outputTokens` numbers on the result side.
const STEP1_USAGE = { inputTokens: 100, outputTokens: 10 };
const STEP2_USAGE = { inputTokens: 200, outputTokens: 25 };

const providerUsage = (u: { inputTokens: number; outputTokens: number }) => ({
  inputTokens: { total: u.inputTokens, noCache: u.inputTokens, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: u.outputTokens, reasoning: 0 },
});

function textChunks(id: string, text: string) {
  return [
    { type: "text-start" as const, id },
    { type: "text-delta" as const, id, delta: text },
    { type: "text-end" as const, id },
  ];
}

/** Step 1: emit a tool-call. Step 2: emit follow-up text. */
function twoStepModel() {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      call += 1;
      const chunks =
        call === 1
          ? [
              { type: "stream-start" as const, warnings: [] },
              {
                type: "response-metadata" as const,
                id: "step-1",
                timestamp: new Date(1000),
                modelId: "mock",
              },
              // ai@7 requires the full tool-input lifecycle before the
              // terminal `tool-call` chunk, otherwise the tool call is never
              // registered and the loop stops after a single step.
              {
                type: "tool-input-start" as const,
                id: "call-1",
                toolName: "lookup",
              },
              {
                type: "tool-input-delta" as const,
                id: "call-1",
                delta: JSON.stringify({ query: "hive" }),
              },
              { type: "tool-input-end" as const, id: "call-1" },
              {
                type: "tool-call" as const,
                toolCallId: "call-1",
                toolName: "lookup",
                input: JSON.stringify({ query: "hive" }),
              },
              {
                type: "finish" as const,
                // ai@7 (LanguageModelV4) finish reasons are objects, not
                // bare strings. A plain string here silently disables tool
                // execution and the loop stops after one step.
                finishReason: { unified: "tool-calls", raw: "tool_calls" } as const,
                usage: providerUsage(STEP1_USAGE),
              },
            ]
          : [
              { type: "stream-start" as const, warnings: [] },
              {
                type: "response-metadata" as const,
                id: "step-2",
                timestamp: new Date(2000),
                modelId: "mock",
              },
              ...textChunks("t2", "Hive is an AI-first PM toolkit."),
              {
                type: "finish" as const,
                finishReason: { unified: "stop", raw: "stop" } as const,
                usage: providerUsage(STEP2_USAGE),
              },
            ];
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

const lookup = tool({
  description: "Look up a term.",
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => ({ definition: `definition of ${query}` }),
});

async function runLoop() {
  let finishUsage: Record<string, unknown> | undefined;
  const result = streamText({
    model: twoStepModel(),
    tools: { lookup },
    stopWhen: stepCountIs(5),
    prompt: "What is hive?",
    onFinish: (event) => {
      finishUsage = event.totalUsage as unknown as Record<string, unknown>;
    },
  });
  // Drain the stream so the loop actually runs to completion.
  await result.consumeStream();
  return { result, finishUsage: () => finishUsage };
}

describe("2-step tool loop (MockLanguageModelV4)", () => {
  test("(a) result.steps has 2 steps: tool-call + tool-result, then follow-up text", async () => {
    const { result } = await runLoop();
    const steps = await result.steps;

    expect(steps).toHaveLength(2);

    // Step 1 is the tool turn.
    expect(steps[0].toolCalls).toHaveLength(1);
    expect(steps[0].toolCalls[0].toolName).toBe("lookup");
    expect(steps[0].toolCalls[0].input).toEqual({ query: "hive" });
    expect(steps[0].toolResults).toHaveLength(1);
    expect(steps[0].toolResults[0].output).toEqual({
      definition: "definition of hive",
    });
    expect(steps[0].text).toBe("");

    // Step 2 is the follow-up text turn, with no further tool calls.
    expect(steps[1].text).toBe("Hive is an AI-first PM toolkit.");
    expect(steps[1].toolCalls).toHaveLength(0);
  });

  test("(b) messagesFromSteps(steps) contains EVERY step's content", async () => {
    const { result } = await runLoop();
    const steps = await result.steps;

    const rows = messagesFromSteps(steps as never, "row-");

    // The step-1 tool call/result must survive into the persisted rows.
    const withToolCalls = rows.filter((r) => (r.toolCalls?.length ?? 0) > 0);
    expect(withToolCalls).toHaveLength(1);
    expect(withToolCalls[0].toolCalls?.[0].toolName).toBe("lookup");
    expect(withToolCalls[0].toolCalls?.[0].output).toEqual({
      definition: "definition of hive",
    });

    // The step-2 text must also survive.
    const texts = rows.map((r) => r.content).filter(Boolean);
    expect(texts).toContain("Hive is an AI-first PM toolkit.");
  });

  test("(c)+(d) last-step response.messages is a STRICT SUBSET of the all-steps history", async () => {
    const { result } = await runLoop();
    const steps = await result.steps;

    // The all-steps history: what every step contributed, in order.
    const allStepMessages = steps.flatMap((s) => s.response.messages);
    const lastStepMessages = steps[steps.length - 1].response.messages;

    // (d) subset: strictly fewer messages than the full history...
    expect(lastStepMessages.length).toBeLessThan(allStepMessages.length);
    // ...and every last-step message does appear in the full history.
    for (const m of lastStepMessages) {
      expect(allStepMessages).toContainEqual(m);
    }

    // (c) the persist path must NOT be sourced from the last step alone.
    // Persisting from `lastStepMessages` would lose the tool call entirely,
    // whereas the real persist path (messagesFromSteps over ALL steps) keeps it.
    const lastStepOnlyRows = messagesFromSteps(
      [steps[steps.length - 1]] as never,
      "last-",
    );
    const persistedRows = messagesFromSteps(steps as never, "all-");

    const toolNames = (rows: ReturnType<typeof messagesFromSteps>) =>
      rows.flatMap((r) => (r.toolCalls ?? []).map((t) => t.toolName));

    expect(toolNames(lastStepOnlyRows)).toEqual([]);
    expect(toolNames(persistedRows)).toEqual(["lookup"]);
    expect(persistedRows.length).toBeGreaterThan(lastStepOnlyRows.length);
  });

  test("(e) per-step usage differs from totalUsage; onFinish usage == sum of per-step usage", async () => {
    const { result, finishUsage } = await runLoop();
    const steps = await result.steps;
    const totalUsage = await result.totalUsage;

    // Per-step usage is genuinely per-step, not the running total.
    expect(steps[0].usage.inputTokens).toBe(STEP1_USAGE.inputTokens);
    expect(steps[0].usage.outputTokens).toBe(STEP1_USAGE.outputTokens);
    expect(steps[1].usage.inputTokens).toBe(STEP2_USAGE.inputTokens);
    expect(steps[1].usage.outputTokens).toBe(STEP2_USAGE.outputTokens);

    // After step 2 no single step's usage equals the total.
    for (const step of steps) {
      expect(step.usage).not.toEqual(totalUsage);
    }

    // The total is the SUM across steps.
    const sum = (key: "inputTokens" | "outputTokens") =>
      steps.reduce((acc, s) => acc + (s.usage[key] ?? 0), 0);

    expect(totalUsage.inputTokens).toBe(sum("inputTokens"));
    expect(totalUsage.outputTokens).toBe(sum("outputTokens"));
    expect(totalUsage.inputTokens).toBe(
      STEP1_USAGE.inputTokens + STEP2_USAGE.inputTokens,
    );
    expect(totalUsage.outputTokens).toBe(
      STEP1_USAGE.outputTokens + STEP2_USAGE.outputTokens,
    );

    // onFinish sees that same summed usage.
    expect(finishUsage()).toEqual(totalUsage);
  });
});
