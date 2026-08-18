import { describe, test, expect } from "vitest";
import { turnsFromStepContent, latestUserInput, resolveConceptRef } from "@/lib/ai/sessionIngestTurns";
import { toIngestUsage, sessionIdForConversation } from "@/services/stakgraph-session-ingest";

// ---------------------------------------------------------------------------
// turnsFromStepContent
// ---------------------------------------------------------------------------
describe("turnsFromStepContent", () => {
  test("maps the four ai-sdk part kinds onto turn types", () => {
    const turns = turnsFromStepContent([
      { type: "text", text: "checking the retry helper" },
      {
        type: "tool-call",
        toolName: "search",
        toolCallId: "c1",
        input: { query: "retry" },
      },
      {
        type: "tool-result",
        toolName: "search",
        toolCallId: "c1",
        output: "…raw tool output…",
      },
    ]);

    expect(turns).toEqual([
      { turn_type: "reasoning", content: "checking the retry helper" },
      {
        turn_type: "tool_call",
        content: '{"query":"retry"}',
        tool: "search",
        tool_call_id: "c1",
      },
      {
        turn_type: "tool_result",
        content: "…raw tool output…",
        tool: "search",
        tool_call_id: "c1",
      },
    ]);
  });

  test("treats reasoning parts as assistant text", () => {
    const turns = turnsFromStepContent([{ type: "reasoning", text: "thinking out loud" }]);
    expect(turns).toEqual([{ turn_type: "reasoning", content: "thinking out loud" }]);
  });

  test("skips empty and whitespace-only text parts", () => {
    expect(
      turnsFromStepContent([
        { type: "text", text: "" },
        { type: "text", text: "   \n " },
      ]),
    ).toEqual([]);
  });

  test("ignores unknown part kinds and non-array content", () => {
    expect(turnsFromStepContent([{ type: "source", id: "x" }])).toEqual([]);
    expect(turnsFromStepContent(undefined)).toEqual([]);
    expect(turnsFromStepContent("nope")).toEqual([]);
  });

  test("falls back to `result` when the adapter omits `output`", () => {
    const turns = turnsFromStepContent([{ type: "tool-result", toolName: "t", toolCallId: "c", result: { ok: 1 } }]);
    expect(turns[0].content).toEqual({ ok: 1 });
  });

  // -------------------------------------------------------------------------
  // Concepts — recorded on the tool_result, resolved to ref_id when known
  // -------------------------------------------------------------------------

  test("records a learn_concept read on the tool_result, not the tool_call", () => {
    const features = [{ id: "stakwork/hive/canvas", ref_id: "REF-1" }];
    const turns = turnsFromStepContent(
      [
        {
          type: "tool-call",
          toolName: "learn_concept",
          toolCallId: "c1",
          input: { conceptId: "stakwork/hive/canvas" },
        },
        {
          type: "tool-result",
          toolName: "learn_concept",
          toolCallId: "c1",
          output: { documentation: "…" },
        },
      ],
      features,
    );

    expect(turns[0].concepts).toBeUndefined();
    expect(turns[1].concepts).toEqual([{ ref_id: "REF-1" }]);
  });

  test("resolves namespaced multi-workspace tool names", () => {
    const turns = turnsFromStepContent(
      [
        {
          type: "tool-call",
          toolName: "hive__learn_concept",
          toolCallId: "c1",
          input: { conceptId: "stakwork/hive/canvas" },
        },
        {
          type: "tool-result",
          toolName: "hive__learn_concept",
          toolCallId: "c1",
          output: {},
        },
      ],
      [{ id: "stakwork/hive/canvas", ref_id: "REF-1" }],
    );
    expect(turns[1].concepts).toEqual([{ ref_id: "REF-1" }]);
  });

  test("records read_concept_documentation reads too", () => {
    const turns = turnsFromStepContent(
      [
        {
          type: "tool-call",
          toolName: "read_concept_documentation",
          toolCallId: "c1",
          input: { conceptId: "stakwork/hive/canvas", workspaceSlug: "hive" },
        },
        {
          type: "tool-result",
          toolName: "read_concept_documentation",
          toolCallId: "c1",
          output: { documentation: "body" },
        },
      ],
      [{ id: "stakwork/hive/canvas", ref_id: "REF-1" }],
    );
    expect(turns[1].concepts).toEqual([{ ref_id: "REF-1" }]);
  });

  test("does NOT record list_concepts — a catalog listing is not a read", () => {
    const turns = turnsFromStepContent(
      [
        { type: "tool-call", toolName: "list_concepts", toolCallId: "c1", input: {} },
        {
          type: "tool-result",
          toolName: "list_concepts",
          toolCallId: "c1",
          output: { concepts: [{ id: "a", ref_id: "REF-A" }] },
        },
      ],
      [{ id: "a", ref_id: "REF-A" }],
    );
    expect(turns[1].concepts).toBeUndefined();
  });

  test("does not record a concept when the read errored", () => {
    const turns = turnsFromStepContent(
      [
        {
          type: "tool-call",
          toolName: "learn_concept",
          toolCallId: "c1",
          input: { conceptId: "missing" },
        },
        {
          type: "tool-result",
          toolName: "learn_concept",
          toolCallId: "c1",
          output: { error: "Concept 'missing' not found" },
        },
      ],
      [],
    );
    expect(turns[1].concepts).toBeUndefined();
  });

  test("pairs concepts by tool_call_id when a step has several reads", () => {
    const features = [
      { id: "o/r/a", ref_id: "REF-A" },
      { id: "o/r/b", ref_id: "REF-B" },
    ];
    const turns = turnsFromStepContent(
      [
        { type: "tool-call", toolName: "learn_concept", toolCallId: "c1", input: { conceptId: "o/r/a" } },
        { type: "tool-call", toolName: "learn_concept", toolCallId: "c2", input: { conceptId: "o/r/b" } },
        { type: "tool-result", toolName: "learn_concept", toolCallId: "c2", output: {} },
        { type: "tool-result", toolName: "learn_concept", toolCallId: "c1", output: {} },
      ],
      features,
    );
    expect(turns[2].concepts).toEqual([{ ref_id: "REF-B" }]);
    expect(turns[3].concepts).toEqual([{ ref_id: "REF-A" }]);
  });
});

// ---------------------------------------------------------------------------
// resolveConceptRef
// ---------------------------------------------------------------------------
describe("resolveConceptRef", () => {
  test("prefers ref_id when the catalog has the concept", () => {
    expect(resolveConceptRef("o/r/a", [{ id: "o/r/a", ref_id: "REF-A" }], "o/r")).toEqual({ ref_id: "REF-A" });
  });

  test("falls back to the prefixed gitree id with no repo", () => {
    expect(resolveConceptRef("o/r/a", [], "o/r")).toEqual({ id: "o/r/a" });
  });

  test("pairs a bare slug with the repo that resolves it", () => {
    expect(resolveConceptRef("canvas", [], "o/r")).toEqual({
      id: "canvas",
      repo: "o/r",
    });
  });

  test("omits repo when there is none to send", () => {
    expect(resolveConceptRef("canvas", [])).toEqual({ id: "canvas" });
  });
});

// ---------------------------------------------------------------------------
// latestUserInput
// ---------------------------------------------------------------------------
describe("latestUserInput", () => {
  test("returns the trailing user message when content is a string", () => {
    expect(
      latestUserInput([
        { role: "system", content: "…" },
        { role: "user", content: "first" },
        { role: "assistant", content: "…" },
        { role: "user", content: "  latest  " },
      ]),
    ).toBe("latest");
  });

  test("joins the text parts of a multi-part user message", () => {
    expect(
      latestUserInput([
        {
          role: "user",
          content: [
            { type: "image", image: "…" },
            { type: "text", text: "look at this" },
            { type: "text", text: "and this" },
          ],
        },
      ]),
    ).toBe("look at this\nand this");
  });

  test("returns undefined when there is no user text", () => {
    expect(latestUserInput([{ role: "assistant", content: "hi" }])).toBeUndefined();
    expect(latestUserInput([{ role: "user", content: "   " }])).toBeUndefined();
    expect(latestUserInput([{ role: "user", content: [{ type: "image", image: "…" }] }])).toBeUndefined();
    expect(latestUserInput(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toIngestUsage
// ---------------------------------------------------------------------------
describe("toIngestUsage", () => {
  test("maps the v6 nested cache-detail shape", () => {
    expect(
      toIngestUsage({
        inputTokens: 120,
        outputTokens: 40,
        inputTokenDetails: { cacheReadTokens: 900, cacheWriteTokens: 30 },
      }),
    ).toEqual({
      input_tokens: 120,
      output_tokens: 40,
      cache_read_tokens: 900,
      cache_write_tokens: 30,
    });
  });

  test("falls back to the flat cachedInputTokens field", () => {
    expect(toIngestUsage({ inputTokens: 1, outputTokens: 2, cachedInputTokens: 7 })).toEqual({
      input_tokens: 1,
      output_tokens: 2,
      cache_read_tokens: 7,
      cache_write_tokens: 0,
    });
  });

  test("zero-fills missing or non-numeric fields", () => {
    expect(toIngestUsage({})).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });
    expect(toIngestUsage({ inputTokens: NaN, outputTokens: "x" })).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });
  });

  test("returns undefined for a missing usage object", () => {
    expect(toIngestUsage(undefined)).toBeUndefined();
    expect(toIngestUsage(null)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sessionIdForConversation
// ---------------------------------------------------------------------------
describe("sessionIdForConversation", () => {
  test("is stable for a conversation, so turns keep appending to one chain", () => {
    expect(sessionIdForConversation("cmabc123")).toBe("jamie-cmabc123");
    expect(sessionIdForConversation("cmabc123")).toBe(sessionIdForConversation("cmabc123"));
  });

  test("strips slashes and caps length — session ids become node keys", () => {
    expect(sessionIdForConversation("a/b/c")).toBe("jamie-a-b-c");
    expect(sessionIdForConversation("x".repeat(400)).length).toBe(256);
  });
});
