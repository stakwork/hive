/**
 * Unit tests for publishVersion — PublishOutcome return values.
 *
 * Covers:
 *  - NOT_CONFIGURED when stakworkId is null
 *  - PUSHED on a successful Stakwork push
 *  - PUSHED on the benign already-exists no-op (422 with "hive_version_id already exists")
 *  - PUSH_FAILED when the Stakwork push throws
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  mockDbPromptFindUnique,
  mockDbPromptVersionFindFirst,
  mockDbTransaction,
  mockDbPromptUpdate,
} = vi.hoisted(() => ({
  mockDbPromptFindUnique: vi.fn(),
  mockDbPromptVersionFindFirst: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockDbPromptUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    prompt: {
      findUnique: mockDbPromptFindUnique,
      findFirst: vi.fn().mockResolvedValue(null),
      update: mockDbPromptUpdate,
    },
    promptVersion: {
      findFirst: mockDbPromptVersionFindFirst,
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: mockDbTransaction,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/config/env", () => ({
  config: { STAKWORK_API_KEY: "test-key", STAKWORK_BASE_URL: "https://stakwork.test" },
}));

vi.mock("@/lib/helpers/prompt-graph-targets", () => ({
  getPromptGraphTargets: vi.fn(() => [
    { label: "t1", config: { jarvisUrl: "https://j1.test", apiKey: "k1" } },
    { label: "t2", config: { jarvisUrl: "https://j2.test", apiKey: "k2" } },
  ]),
}));

import { publishVersion } from "@/services/prompts/prompt-sync";

const BASE_PROMPT = {
  id: "prompt-1",
  name: "MY_PROMPT",
  value: "old",
  description: "desc",
  publishedVersionId: "v1",
  syncStatus: "OK",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BASE_VERSION = {
  id: "v2",
  promptId: "prompt-1",
  versionNumber: 2,
  value: "new value",
  description: "v2 desc",
  published: false,
  createdAt: new Date(),
};

function jarvisOk() {
  return { ok: true, status: 200, json: async () => ({ status: "success" }) } as Response;
}

function setupBaseMocks(prompt: typeof BASE_PROMPT) {
  vi.clearAllMocks();
  mockDbPromptFindUnique.mockResolvedValueOnce(prompt);
  mockDbPromptVersionFindFirst.mockResolvedValueOnce(BASE_VERSION);
  mockDbTransaction.mockResolvedValueOnce([undefined, undefined, undefined]);
  mockDbPromptUpdate.mockResolvedValue(prompt);
}

describe("publishVersion — PublishOutcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NOT_CONFIGURED when prompt.stakworkId is null (no push attempted)", async () => {
    const promptNoStakwork = { ...BASE_PROMPT, stakworkId: null };
    setupBaseMocks(promptNoStakwork);
    // Jarvis graph recorder still fires
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jarvisOk())
      .mockResolvedValueOnce(jarvisOk());

    const result = await publishVersion("prompt-1", "v2");

    expect(result.syncOutcome).toBe("NOT_CONFIGURED");
    expect(result.versionId).toBe("v2");
    expect(result.versionNumber).toBe(2);

    // Confirm no PUT to prompts endpoint
    const putCall = vi.mocked(global.fetch).mock.calls.find(
      ([url, opts]) =>
        typeof url === "string" &&
        url.includes("/prompts/") &&
        (opts as RequestInit)?.method === "PUT",
    );
    expect(putCall).toBeUndefined();
  });

  it("returns PUSHED on a successful Stakwork push", async () => {
    const promptWithStakwork = { ...BASE_PROMPT, stakworkId: 42 };
    setupBaseMocks(promptWithStakwork);
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jarvisOk())     // Jarvis target-1
      .mockResolvedValueOnce(jarvisOk())     // Jarvis target-2
      .mockResolvedValueOnce({ ok: true, text: async () => "" } as Response); // Stakwork PUT

    const result = await publishVersion("prompt-1", "v2");

    expect(result.syncOutcome).toBe("PUSHED");
    expect(result.versionId).toBe("v2");
    expect(result.versionNumber).toBe(2);
  });

  it("returns PUSHED on the benign already-exists no-op (422 + hive_version_id already exists)", async () => {
    const promptWithStakwork = { ...BASE_PROMPT, stakworkId: 42 };
    setupBaseMocks(promptWithStakwork);
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jarvisOk())
      .mockResolvedValueOnce(jarvisOk())
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => "hive_version_id already exists",
      } as unknown as Response);

    const result = await publishVersion("prompt-1", "v2");

    expect(result.syncOutcome).toBe("PUSHED");
  });

  it("returns PUSH_FAILED when the Stakwork push throws", async () => {
    const promptWithStakwork = { ...BASE_PROMPT, stakworkId: 42 };
    setupBaseMocks(promptWithStakwork);
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jarvisOk())
      .mockResolvedValueOnce(jarvisOk())
      .mockRejectedValueOnce(new Error("network error"));

    const result = await publishVersion("prompt-1", "v2");

    expect(result.syncOutcome).toBe("PUSH_FAILED");
    expect(result.versionId).toBe("v2");
    expect(result.versionNumber).toBe(2);
  });

  it("does not throw regardless of push outcome (PUSH_FAILED path)", async () => {
    const promptWithStakwork = { ...BASE_PROMPT, stakworkId: 42 };
    setupBaseMocks(promptWithStakwork);
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jarvisOk())
      .mockResolvedValueOnce(jarvisOk())
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "error" } as unknown as Response);

    await expect(publishVersion("prompt-1", "v2")).resolves.not.toThrow();
  });
});
