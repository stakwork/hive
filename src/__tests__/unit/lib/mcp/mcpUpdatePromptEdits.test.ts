import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const { mockWritePromptThrough, mockGetRawPromptValue } = vi.hoisted(() => ({
  mockWritePromptThrough: vi.fn(),
  mockGetRawPromptValue: vi.fn(),
}));

vi.mock("@/services/prompts/prompt-sync", () => ({
  writePromptThrough: mockWritePromptThrough,
}));

vi.mock("@/services/prompts/prompt-read", () => ({
  getRawPromptValue: mockGetRawPromptValue,
  getResolvedPrompt: vi.fn(),
  getResolvedPromptVersion: vi.fn(),
  listPromptVersions: vi.fn(),
}));

// ── Imports ────────────────────────────────────────────────────────────────
import { mcpUpdatePromptEdits } from "@/lib/mcp/mcpTools";

const AUTH = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "stakwork",
};

const RAW = [
  "You are a helpful assistant.",
  "",
  "Rules:",
  "- Be concise.",
].join("\n");

function rawValue(value = RAW) {
  return {
    id: "prompt-1",
    name: "MY_PROMPT",
    versionId: "version-2",
    versionNumber: 2,
    value,
  };
}

function writeResult() {
  return {
    prompt: { id: "prompt-1", name: "MY_PROMPT" },
    version: {
      id: "version-3",
      versionNumber: 3,
      value: "written",
      description: null,
      published: false,
    },
  };
}

function text(result: { content: { text: string }[] }): string {
  return (result.content[0] as { text: string }).text;
}

describe("mcpUpdatePromptEdits — resolves edits to a full value", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRawPromptValue.mockResolvedValue(rawValue());
    mockWritePromptThrough.mockResolvedValue(writeResult());
  });

  it("writes the complete edited value, not the edit list", async () => {
    const result = await mcpUpdatePromptEdits(AUTH, "prompt-1", [
      { oldStr: "- Be concise.", newStr: "- Be extremely concise." },
    ]);

    expect(result.isError).toBeFalsy();
    expect(mockWritePromptThrough).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "prompt-1",
        value: RAW.replace("- Be concise.", "- Be extremely concise."),
        userId: "user-1",
        source: "MCP",
      }),
    );
  });

  it("reads the raw current value, so edits are not built against resolved text", async () => {
    await mcpUpdatePromptEdits(AUTH, "prompt-1", [{ oldStr: "Rules:", newStr: "Guidelines:" }]);

    expect(mockGetRawPromptValue).toHaveBeenCalledWith("prompt-1");
  });

  it("forwards description when provided", async () => {
    await mcpUpdatePromptEdits(
      AUTH,
      "prompt-1",
      [{ oldStr: "Rules:", newStr: "Guidelines:" }],
      "New desc",
    );

    expect(mockWritePromptThrough).toHaveBeenCalledWith(
      expect.objectContaining({ description: "New desc" }),
    );
  });

  it("applies multiple edits in order", async () => {
    await mcpUpdatePromptEdits(AUTH, "prompt-1", [
      { oldStr: "helpful", newStr: "terse" },
      { oldStr: "- Be concise.", newStr: "- Be brief." },
    ]);

    const written = mockWritePromptThrough.mock.calls[0][0].value;
    expect(written).toContain("You are a terse assistant.");
    expect(written).toContain("- Be brief.");
  });
});

describe("mcpUpdatePromptEdits — refuses to write on a bad edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRawPromptValue.mockResolvedValue(rawValue());
    mockWritePromptThrough.mockResolvedValue(writeResult());
  });

  it("fails without writing when oldStr does not match (stale read)", async () => {
    const result = await mcpUpdatePromptEdits(AUTH, "prompt-1", [
      { oldStr: "- Be terse.", newStr: "- Be brief." },
    ]);

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/not found/i);
    expect(mockWritePromptThrough).not.toHaveBeenCalled();
  });

  it("reports the base prompt name and version in the failure", async () => {
    const result = await mcpUpdatePromptEdits(AUTH, "prompt-1", [
      { oldStr: "nope", newStr: "x" },
    ]);

    expect(text(result)).toContain("MY_PROMPT v2");
  });

  it("fails without writing when an edit is ambiguous", async () => {
    mockGetRawPromptValue.mockResolvedValue(rawValue("foo bar foo"));

    const result = await mcpUpdatePromptEdits(AUTH, "prompt-1", [
      { oldStr: "foo", newStr: "qux" },
    ]);

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/matched 2 times/i);
    expect(mockWritePromptThrough).not.toHaveBeenCalled();
  });

  it("does not write any earlier edit when a later one fails", async () => {
    const result = await mcpUpdatePromptEdits(AUTH, "prompt-1", [
      { oldStr: "- Be concise.", newStr: "- Be brief." },
      { oldStr: "missing", newStr: "x" },
    ]);

    expect(result.isError).toBe(true);
    expect(mockWritePromptThrough).not.toHaveBeenCalled();
  });
});

describe("mcpUpdatePromptEdits — base lookup failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWritePromptThrough.mockResolvedValue(writeResult());
  });

  it("maps a missing prompt to a not-found error", async () => {
    mockGetRawPromptValue.mockResolvedValue({ notFound: true });

    const result = await mcpUpdatePromptEdits(AUTH, "nope", [{ oldStr: "a", newStr: "b" }]);

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/prompt not found/i);
    expect(mockWritePromptThrough).not.toHaveBeenCalled();
  });

  it("surfaces a read error without writing", async () => {
    mockGetRawPromptValue.mockResolvedValue({ error: "DB is down" });

    const result = await mcpUpdatePromptEdits(AUTH, "prompt-1", [{ oldStr: "a", newStr: "b" }]);

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/DB is down/);
    expect(mockWritePromptThrough).not.toHaveBeenCalled();
  });
});
