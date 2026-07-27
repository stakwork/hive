import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const { mockGetRawPromptValue, mockGetResolvedPrompt } = vi.hoisted(() => ({
  mockGetRawPromptValue: vi.fn(),
  mockGetResolvedPrompt: vi.fn(),
}));

vi.mock("@/services/prompts/prompt-read", () => ({
  getRawPromptValue: mockGetRawPromptValue,
  getResolvedPrompt: mockGetResolvedPrompt,
}));

vi.mock("nanoid", () => ({ nanoid: () => "proposal-1" }));

// ── Imports ────────────────────────────────────────────────────────────────
import { buildPromptTools } from "@/lib/ai/promptTools";
import {
  PROPOSE_PROMPT_UPDATE_TOOL,
} from "@/lib/proposals/types";

const RAW = ["You are a helpful assistant.", "", "Rules:", "- Be concise."].join("\n");

function rawValue(value = RAW) {
  return {
    id: "prompt-1",
    name: "MY_PROMPT",
    versionId: "version-2",
    versionNumber: 2,
    value,
  };
}

type ToolExecute = (input: Record<string, unknown>) => Promise<Record<string, unknown>>;

function proposeUpdate(): ToolExecute {
  const tools = buildPromptTools("user-1");
  return (tools[PROPOSE_PROMPT_UPDATE_TOOL] as unknown as { execute: ToolExecute }).execute;
}

function getPrompt(): ToolExecute {
  const tools = buildPromptTools("user-1");
  return (tools.get_prompt as unknown as { execute: ToolExecute }).execute;
}

describe("propose_prompt_update — edits resolve to a full value", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRawPromptValue.mockResolvedValue(rawValue());
  });

  it("stores the complete edited value in the payload, not the edit list", async () => {
    const result = await proposeUpdate()({
      prompt_id: "prompt-1",
      edits: [{ oldStr: "- Be concise.", newStr: "- Be extremely concise." }],
    });

    const expected = RAW.replace("- Be concise.", "- Be extremely concise.");
    expect(result.kind).toBe("promptUpdate");
    expect((result.payload as { value: string }).value).toBe(expected);
    expect(result.payload).not.toHaveProperty("edits");
  });

  it("diffs the edited value against the raw base", async () => {
    const result = await proposeUpdate()({
      prompt_id: "prompt-1",
      edits: [{ oldStr: "Rules:", newStr: "Guidelines:" }],
    });

    const meta = result.meta as { oldStr: string; newStr: string };
    expect(meta.oldStr).toBe(RAW);
    expect(meta.newStr).toBe(RAW.replace("Rules:", "Guidelines:"));
  });

  it("still accepts a full value for a wholesale rewrite", async () => {
    const result = await proposeUpdate()({
      prompt_id: "prompt-1",
      value: "Totally new prompt.",
    });

    expect((result.payload as { value: string }).value).toBe("Totally new prompt.");
    expect((result.meta as { newStr: string }).newStr).toBe("Totally new prompt.");
  });

  it("rejects an edit whose oldStr does not match, without emitting a proposal", async () => {
    const result = await proposeUpdate()({
      prompt_id: "prompt-1",
      edits: [{ oldStr: "- Be terse.", newStr: "x" }],
    });

    expect(result.error).toMatch(/not found/i);
    expect(result.error).toContain("MY_PROMPT v2");
    expect(result.kind).toBeUndefined();
  });

  it("rejects passing both value and edits", async () => {
    const result = await proposeUpdate()({
      prompt_id: "prompt-1",
      value: "whole thing",
      edits: [{ oldStr: "Rules:", newStr: "Guidelines:" }],
    });

    expect(result.error).toMatch(/not both/i);
    expect(result.kind).toBeUndefined();
  });

  it("rejects passing neither value nor edits", async () => {
    const result = await proposeUpdate()({ prompt_id: "prompt-1" });

    expect(result.error).toMatch(/required/i);
    expect(result.kind).toBeUndefined();
  });

  it("reports a missing prompt before applying edits", async () => {
    mockGetRawPromptValue.mockResolvedValue({ notFound: true });

    const result = await proposeUpdate()({
      prompt_id: "nope",
      edits: [{ oldStr: "a", newStr: "b" }],
    });

    expect(result.error).toMatch(/not found/i);
  });
});

describe("get_prompt — raw mode feeds the edit path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the verbatim stored value with raw: true", async () => {
    mockGetRawPromptValue.mockResolvedValue(rawValue("Hello {{NAME}}"));

    const result = await getPrompt()({ id_or_name: "MY_PROMPT", raw: true });

    expect(result.value).toBe("Hello {{NAME}}");
    expect(result.raw).toBe(true);
    expect(result.versionId).toBe("version-2");
    expect(mockGetResolvedPrompt).not.toHaveBeenCalled();
  });

  it("returns resolved text by default", async () => {
    mockGetResolvedPrompt.mockResolvedValue({
      id: "prompt-1",
      name: "MY_PROMPT",
      versionId: "version-2",
      versionNumber: 2,
      resolvedText: "Hello Evan",
      missingVariables: [],
    });

    const result = await getPrompt()({ id_or_name: "MY_PROMPT" });

    expect(result.resolvedText).toBe("Hello Evan");
    expect(result.value).toBeUndefined();
    expect(mockGetRawPromptValue).not.toHaveBeenCalled();
  });

  it("surfaces a not-found in raw mode", async () => {
    mockGetRawPromptValue.mockResolvedValue({ notFound: true });

    const result = await getPrompt()({ id_or_name: "NOPE", raw: true });

    expect(result.error).toMatch(/not found/i);
  });
});
