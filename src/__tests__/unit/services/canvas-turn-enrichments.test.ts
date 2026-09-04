/**
 * Unit tests for org-canvas conversation title generation.
 *
 * `generateConversationTitle` is a Bifrost-free generateObject one-shot.
 * `maybeGenerateAndPersistTitle` is the persist-side writer: skip on
 * error/empty, write once via settings.titleSource === "llm", retry when
 * that marker is unset, and never throw (so an LLM failure cannot fall
 * into /api/ask/quick's persist catch and append a fake error row).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@/lib/ai/provider", () => ({
  getApiKeyForProvider: vi.fn(() => "test-api-key"),
  getModel: vi.fn(() => "mock-model"),
}));

vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    sharedConversation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
}));

vi.mock("@/lib/pusher", () => ({
  notifyCanvasConversationUpdated: vi.fn(),
  getWorkspaceChannelName: vi.fn(),
  PUSHER_EVENTS: {},
  pusherServer: { trigger: vi.fn() },
}));

import { generateObject } from "ai";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { db } from "@/lib/db";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import { TITLE_MAX_LENGTH } from "@/lib/ai/conversationHelpers";
import {
  generateConversationTitle,
  maybeGenerateAndPersistTitle,
  sanitizeGeneratedTitle,
} from "@/services/canvas-turn-enrichments";

const generateObjectMock = generateObject as ReturnType<typeof vi.fn>;
const getModelMock = getModel as ReturnType<typeof vi.fn>;
const getApiKeyMock = getApiKeyForProvider as ReturnType<typeof vi.fn>;
const getBifrostMock = getBifrostForLLM as ReturnType<typeof vi.fn>;
const findUnique = db.sharedConversation.findUnique as ReturnType<typeof vi.fn>;
const prismaUpdate = db.sharedConversation.update as ReturnType<typeof vi.fn>;
const executeRaw = db.$executeRaw as ReturnType<typeof vi.fn>;
const notify = notifyCanvasConversationUpdated as ReturnType<typeof vi.fn>;

const USER = "How does the auth middleware work when tokens expire?";
const ASSISTANT = "It refreshes the access token using the refresh token cookie.";

beforeEach(() => {
  vi.clearAllMocks();
  getApiKeyMock.mockReturnValue("test-api-key");
  getModelMock.mockReturnValue("mock-model");
  generateObjectMock.mockResolvedValue({
    object: { title: "Auth token refresh" },
  });
  findUnique.mockResolvedValue({
    title: USER.slice(0, 200),
    settings: { extraWorkspaceSlugs: ["acme"] },
  });
  executeRaw.mockResolvedValue(1);
});

describe("sanitizeGeneratedTitle", () => {
  it("trims, strips wrapping quotes, and collapses whitespace", () => {
    expect(sanitizeGeneratedTitle('  "Auth token refresh"  ')).toBe(
      "Auth token refresh",
    );
    expect(sanitizeGeneratedTitle("'Auth token refresh'")).toBe(
      "Auth token refresh",
    );
    expect(sanitizeGeneratedTitle("`Auth   token\nrefresh`")).toBe(
      "Auth token refresh",
    );
  });

  it("keeps only the first 6 words", () => {
    expect(
      sanitizeGeneratedTitle("one two three four five six seven eight"),
    ).toBe("one two three four five six");
  });

  it("caps at TITLE_MAX_LENGTH", () => {
    const longWord = "x".repeat(TITLE_MAX_LENGTH + 40);
    const result = sanitizeGeneratedTitle(longWord);
    expect(result).toHaveLength(TITLE_MAX_LENGTH);
  });

  it("returns null for empty / whitespace / quotes-only input", () => {
    expect(sanitizeGeneratedTitle("")).toBeNull();
    expect(sanitizeGeneratedTitle("   ")).toBeNull();
    expect(sanitizeGeneratedTitle('""')).toBeNull();
  });
});

describe("generateConversationTitle", () => {
  it("calls generateObject with the default Anthropic key and no Bifrost", async () => {
    const title = await generateConversationTitle(USER, ASSISTANT);

    expect(title).toBe("Auth token refresh");
    expect(getApiKeyMock).toHaveBeenCalledWith("anthropic");
    expect(getModelMock).toHaveBeenCalledWith("anthropic", "test-api-key");
    expect(getBifrostMock).not.toHaveBeenCalled();

    const call = generateObjectMock.mock.calls[0][0];
    expect(call.prompt).toContain(USER);
    expect(call.prompt).toContain(ASSISTANT);
    expect(call.system).toMatch(/2-6 words/i);
    expect(call.system).toMatch(/not a sentence/i);
    expect(call.system).toMatch(/not a truncated copy/i);
    expect(call.system).toMatch(/No quotes/i);
  });

  it("post-processes LLM output (quotes, word cap)", async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        title: '"How the auth middleware works when tokens expire quickly"',
      },
    });

    const title = await generateConversationTitle(USER, ASSISTANT);
    expect(title).toBe("How the auth middleware works when");
  });

  it("returns null on empty sanitized output without throwing", async () => {
    generateObjectMock.mockResolvedValue({ object: { title: "   " } });
    await expect(
      generateConversationTitle(USER, ASSISTANT),
    ).resolves.toBeNull();
  });

  it("swallows LLM failures and returns null", async () => {
    generateObjectMock.mockRejectedValue(new Error("model down"));
    await expect(
      generateConversationTitle(USER, ASSISTANT),
    ).resolves.toBeNull();
    expect(getBifrostMock).not.toHaveBeenCalled();
  });
});

describe("maybeGenerateAndPersistTitle", () => {
  const rowId = "conv-1";

  it("skips when assistantIsError is true", async () => {
    await maybeGenerateAndPersistTitle({
      rowId,
      userText: USER,
      assistantText: ASSISTANT,
      assistantIsError: true,
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("skips when assistant text is empty or whitespace", async () => {
    await maybeGenerateAndPersistTitle({
      rowId,
      userText: USER,
      assistantText: "  \n  ",
      assistantIsError: false,
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("writes title + settings.titleSource=llm on a fresh row", async () => {
    findUnique.mockResolvedValue({
      title: "Untitled Conversation",
      settings: {},
    });

    await maybeGenerateAndPersistTitle({
      rowId,
      userText: USER,
      assistantText: ASSISTANT,
      assistantIsError: false,
    });

    expect(generateObjectMock).toHaveBeenCalledOnce();
    expect(executeRaw).toHaveBeenCalledOnce();
    const serialized = JSON.stringify(executeRaw.mock.calls[0]);
    expect(serialized).toContain("Auth token refresh");
    expect(serialized).toContain("titleSource");
    expect(serialized).toContain(rowId);
    expect(prismaUpdate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(rowId, "user-turn");
  });

  it("no-ops when settings.titleSource is already llm", async () => {
    findUnique.mockResolvedValue({
      title: "Auth token refresh",
      settings: { titleSource: "llm" },
    });

    await maybeGenerateAndPersistTitle({
      rowId,
      userText: USER,
      assistantText: ASSISTANT,
      assistantIsError: false,
    });

    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("retries when titleSource is unset even if a placeholder title exists", async () => {
    findUnique.mockResolvedValue({
      title: USER.slice(0, 200),
      settings: { extraWorkspaceSlugs: ["acme"] },
    });

    await maybeGenerateAndPersistTitle({
      rowId,
      userText: USER,
      assistantText: ASSISTANT,
      assistantIsError: false,
    });

    expect(generateObjectMock).toHaveBeenCalledOnce();
    expect(executeRaw).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(rowId, "user-turn");
  });

  it("does not write when the LLM returns an empty title", async () => {
    generateObjectMock.mockResolvedValue({ object: { title: "   " } });

    await maybeGenerateAndPersistTitle({
      rowId,
      userText: USER,
      assistantText: ASSISTANT,
      assistantIsError: false,
    });

    expect(executeRaw).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not write and does not throw when the LLM fails", async () => {
    generateObjectMock.mockRejectedValue(new Error("model down"));

    await expect(
      maybeGenerateAndPersistTitle({
        rowId,
        userText: USER,
        assistantText: ASSISTANT,
        assistantIsError: false,
      }),
    ).resolves.toBeUndefined();

    expect(executeRaw).not.toHaveBeenCalled();
    expect(prismaUpdate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("never throws into a persist catch (LLM failure cannot append an assistant error row)", async () => {
    // Mirrors /api/ask/quick's after(): title generation sits in a nested
    // try after a successful appendTurnMessages. Even if that nested try
    // were omitted, the helper itself must not reject — a rejection would
    // fall into the persist catch and write source.kind === "error".
    generateObjectMock.mockRejectedValue(new Error("model down"));

    const persistCatch = vi.fn();
    try {
      await maybeGenerateAndPersistTitle({
        rowId,
        userText: USER,
        assistantText: ASSISTANT,
        assistantIsError: false,
      });
    } catch {
      persistCatch();
    }

    expect(persistCatch).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(prismaUpdate).not.toHaveBeenCalled();
  });

  it("swallows DB errors so a title failure cannot append an assistant error row", async () => {
    findUnique.mockRejectedValue(new Error("db down"));

    await expect(
      maybeGenerateAndPersistTitle({
        rowId,
        userText: USER,
        assistantText: ASSISTANT,
        assistantIsError: false,
      }),
    ).resolves.toBeUndefined();

    expect(executeRaw).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
