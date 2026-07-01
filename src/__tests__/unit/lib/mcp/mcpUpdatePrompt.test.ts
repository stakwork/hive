import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const { mockWritePromptThrough } = vi.hoisted(() => ({
  mockWritePromptThrough: vi.fn(),
}));

vi.mock("@/services/prompts/prompt-sync", () => ({
  writePromptThrough: mockWritePromptThrough,
}));

// ── Imports ────────────────────────────────────────────────────────────────
import { mcpUpdatePrompt } from "@/lib/mcp/mcpTools";

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

function makeResult(versionNumber: number) {
  return {
    prompt: {
      id: "prompt-1",
      name: "MY_PROMPT",
      value: "Updated content",
      description: "A description",
      publishedVersionId: `version-${versionNumber}`,
      stakworkId: null,
      syncStatus: "OK",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    version: {
      id: `version-${versionNumber}`,
      versionNumber,
      value: "Updated content",
      published: true,
      createdAt: new Date(),
    },
  };
}

describe("mcpUpdatePrompt — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWritePromptThrough.mockResolvedValue(makeResult(2));
  });

  it("returns id, name, versionId, versionNumber > 1 on success", async () => {
    const result = await mcpUpdatePrompt(STAKWORK_AUTH, "prompt-1", "Updated content");

    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.id).toBe("prompt-1");
    expect(data.name).toBe("MY_PROMPT");
    expect(data.versionId).toBe("version-2");
    expect(data.versionNumber).toBe(2);
  });

  it("forwards auth.userId as userId to writePromptThrough", async () => {
    await mcpUpdatePrompt(STAKWORK_AUTH, "prompt-1", "Updated content");

    expect(mockWritePromptThrough).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("calls writePromptThrough with promptId (service owns version creation)", async () => {
    await mcpUpdatePrompt(STAKWORK_AUTH, "prompt-1", "Updated content");

    expect(mockWritePromptThrough).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: "prompt-1" }),
    );
    // Must NOT touch db.promptVersion directly — service handles history
  });

  it("passes description when provided", async () => {
    await mcpUpdatePrompt(STAKWORK_AUTH, "prompt-1", "Updated content", "New desc");

    expect(mockWritePromptThrough).toHaveBeenCalledWith(
      expect.objectContaining({ description: "New desc" }),
    );
  });

  it("passes description as undefined when omitted", async () => {
    await mcpUpdatePrompt(STAKWORK_AUTH, "prompt-1", "Updated content");

    expect(mockWritePromptThrough).toHaveBeenCalledWith(
      expect.objectContaining({ description: undefined }),
    );
  });
});

describe("mcpUpdatePrompt — stakwork-only gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects update on a non-stakwork workspace", async () => {
    const result = await mcpUpdatePrompt(OTHER_AUTH, "prompt-1", "content");

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/stakwork workspace/i);
    expect(mockWritePromptThrough).not.toHaveBeenCalled();
  });
});

describe("mcpUpdatePrompt — error mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps status 404 to a prompt-not-found error", async () => {
    mockWritePromptThrough.mockRejectedValue(
      Object.assign(new Error("Prompt not found"), { status: 404 }),
    );

    const result = await mcpUpdatePrompt(STAKWORK_AUTH, "nonexistent", "value");

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/prompt not found/i);
  });

  it("surfaces unexpected errors with a generic message", async () => {
    mockWritePromptThrough.mockRejectedValue(new Error("DB is down"));

    const result = await mcpUpdatePrompt(STAKWORK_AUTH, "prompt-1", "value");

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/DB is down/);
  });
});

describe("mcpUpdatePrompt — prior versions preserved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWritePromptThrough.mockResolvedValue(makeResult(3));
  });

  it("delegates version creation entirely to writePromptThrough (service owns history)", async () => {
    await mcpUpdatePrompt(STAKWORK_AUTH, "prompt-1", "v3 content");

    // Called exactly once with the promptId — service creates the new version
    expect(mockWritePromptThrough).toHaveBeenCalledTimes(1);
    expect(mockWritePromptThrough).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: "prompt-1" }),
    );
  });
});
