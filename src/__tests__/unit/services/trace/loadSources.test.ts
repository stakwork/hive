/**
 * `services/trace/loadSources.ts` against the trace fixtures
 * (`src/__tests__/fixtures/trace/`): a strut `events.jsonl` with a tool
 * output over 1,500 characters, and a Jamie conversation with a
 * `runId` hand-off into that run.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildStrutSteps, loadJamieSources } from "@/services/trace/loadSources";

const FIXTURES = path.join(process.cwd(), "src/__tests__/fixtures/trace");

function readEvents(): unknown[] {
  return fs
    .readFileSync(path.join(FIXTURES, "strut-events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function readConversation(): { messages: unknown[] } {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, "jamie-conversation.json"), "utf8"));
}

describe("buildStrutSteps", () => {
  const events = readEvents();

  test("keeps a step.end's toolCallId and strips strut's tool: prefix", () => {
    const steps = buildStrutSteps(events);
    expect(steps.map((s) => s.toolCallId)).toEqual(["call-1", "call-2", "call-3"]);
    expect(steps[0].toolName).toBe("search/accounts");
  });

  test("falls back to the short preview when no full output was resolved", () => {
    const steps = buildStrutSteps(events);
    const sum = steps.find((s) => s.toolCallId === "call-2")!;
    expect(sum.output).not.toContain("$12,338.84");
    expect(sum.output).toContain("truncated");
  });

  test("uses the full output when one is resolved by outputRef", () => {
    const full = fs.readFileSync(path.join(FIXTURES, "outputs/002-tool.json"), "utf8");
    const fullText = JSON.parse(full) as string;
    expect(fullText.length).toBeGreaterThan(1500);
    const outputs = new Map([["outputs/002-tool.json", fullText]]);
    const steps = buildStrutSteps(events, outputs);
    const sum = steps.find((s) => s.toolCallId === "call-2")!;
    expect(sum.output).toContain("$12,338.84");
  });

  test("carries the step's input forward from its step.start", () => {
    const steps = buildStrutSteps(events);
    const summary = steps.find((s) => s.toolCallId === "call-3")!;
    expect(summary.input).toContain("$12,338.84");
  });
});

describe("loadJamieSources", () => {
  test("flattens text rows and tool calls, oldest first", async () => {
    const { messages } = readConversation();
    const steps = await loadJamieSources(messages as any);
    expect(steps.map((s) => s.key)).toEqual(["m-0", "jamie-call-1", "m-2"]);
  });

  test("follows a runId a tool call's output names into that run's steps", async () => {
    const { messages } = readConversation();
    const events = readEvents();
    const followed = await loadJamieSources(messages as any, async (runId) => {
      expect(runId).toBe("run-1");
      return buildStrutSteps(events);
    });
    const keys = followed.map((s) => s.key);
    expect(keys).toEqual(["m-0", "jamie-call-1", "1", "2", "3", "m-2"]);
    // Spliced steps keep increasing order so upstream/downstream bounds still work.
    expect(followed.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("a hand-off the caller cannot resolve is skipped, not thrown", async () => {
    const { messages } = readConversation();
    const steps = await loadJamieSources(messages as any, async () => null);
    expect(steps.map((s) => s.key)).toEqual(["m-0", "jamie-call-1", "m-2"]);
  });
});
