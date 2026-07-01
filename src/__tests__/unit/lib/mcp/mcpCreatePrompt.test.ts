import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const { mockWritePromptThrough } = vi.hoisted(() => ({
  mockWritePromptThrough: vi.fn(),
}));

vi.mock("@/services/prompts/prompt-sync", () => ({
  writePromptThrough: mockWritePromptThrough,
}));

// ── Imports ────────────────────────────────────────────────────────────────
import { mcpCreatePrompt } from "@/lib/mcp/mcpTools";

const STAKWORK_AUTH = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "stakwork",
};

const OTHER_AUTH = {
  userId: "user-2",
  workspaceId: "ws-2",
  workspaceSlug: "some-other-workspace",
};

const PROMPT_RESULT = {
  prompt: {
    id: "prompt-1",
    name: "MY_PROMPT",
    value: "Hello world",
    description: null,
    publishedVersionId: "version-1",
    stakworkId: null,
    syncStatus: "OK",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  version: {
    id: "version-1",
    versionNumber: 1,
    value: "Hello world",
    published: true,
    createdAt: new Date(),
  },
};

describe("mcpCreatePrompt — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWritePromptThrough.mockResolvedValue(PROMPT_RESULT);
  });

  it("returns id, name, versionId, versionNumber on success", async () => {
    const result = await mcpCreatePrompt(STAKWORK_AUTH, "MY_PROMPT", "Hello world");

    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.id).toBe("prompt-1");
    expect(data.name).toBe("MY_PROMPT");
    expect(data.versionId).toBe("version-1");
    expect(data.versionNumber).toBe(1);
  });

  it("forwards auth.userId as userId to writePromptThrough", async () => {
    await mcpCreatePrompt(STAKWORK_AUTH, "MY_PROMPT", "Hello world");

    expect(mockWritePromptThrough).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("forwards name, value, description to writePromptThrough", async () => {
    await mcpCreatePrompt(STAKWORK_AUTH, "MY_PROMPT", "Hello world", "A test prompt");

    expect(mockWritePromptThrough).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "MY_PROMPT",
        value: "Hello world",
        description: "A test prompt",
      }),
    );
  });

  it("passes description as undefined when omitted", async () => {
    await mcpCreatePrompt(STAKWORK_AUTH, "MY_PROMPT", "Hello world");

    expect(mockWritePromptThrough).toHaveBeenCalledWith(
      expect.objectContaining({ description: undefined }),
    );
  });
});

describe("mcpCreatePrompt — non-stakwork workspace allowed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWritePromptThrough.mockResolvedValue(PROMPT_RESULT);
  });

  it("succeeds on a non-stakwork workspace and calls writePromptThrough", async () => {
    const result = await mcpCreatePrompt(OTHER_AUTH, "MY_PROMPT", "Hello world");

    expect(result.isError).toBeFalsy();
    expect(mockWritePromptThrough).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-2", name: "MY_PROMPT", value: "Hello world" }),
    );
  });
});

describe("mcpCreatePrompt — error mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps status 400 to an UPPERCASE format error", async () => {
    mockWritePromptThrough.mockRejectedValue(
      Object.assign(new Error("bad name"), { status: 400 }),
    );

    const result = await mcpCreatePrompt(STAKWORK_AUTH, "bad_name", "value");

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/uppercase/i);
  });

  it("maps status 409 to a duplicate-name error", async () => {
    mockWritePromptThrough.mockRejectedValue(
      Object.assign(new Error("duplicate"), { status: 409 }),
    );

    const result = await mcpCreatePrompt(STAKWORK_AUTH, "MY_PROMPT", "value");

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/already exists/i);
  });

  it("surfaces unexpected errors with a generic message", async () => {
    mockWritePromptThrough.mockRejectedValue(new Error("DB is down"));

    const result = await mcpCreatePrompt(STAKWORK_AUTH, "MY_PROMPT", "value");

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/DB is down/);
  });
});
