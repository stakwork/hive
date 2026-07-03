/**
 * Unit tests for the backfill-prompt-graph.ts script logic.
 *
 * Tests the per-prompt resolution logic (published + latest draft selection)
 * using a mocked Prisma client and mocked sendPromptGraphRequest.
 *
 * We test the logic by extracting the core behavior into re-usable assertions
 * against mocked Prisma calls — the script itself is not directly imported
 * (it calls process.exit), but the logic is captured here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockSendPromptGraphRequest } = vi.hoisted(() => ({
  mockSendPromptGraphRequest: vi.fn(),
}));

vi.mock("@/services/prompts/prompt-sync", () => ({
  sendPromptGraphRequest: mockSendPromptGraphRequest,
}));

// ─── Inline logic extracted from the script for unit testing ─────────────────

import { sendPromptGraphRequest } from "@/services/prompts/prompt-sync";

type PromptParams = {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
};

interface PromptRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  publishedVersion: { id: string; value: string } | null;
}

interface VersionRow {
  id: string;
  value: string;
}

/**
 * Core per-prompt dispatch logic mirroring scripts/backfill-prompt-graph.ts
 */
async function processPrompt(
  prompt: PromptRow,
  latestDraft: VersionRow | null,
  publishedOnly: boolean,
): Promise<{ saved: number; skipped: number; failed: number }> {
  const published = prompt.publishedVersion;
  const draft = publishedOnly ? null : latestDraft;

  if (!published && !draft) {
    return { saved: 0, skipped: 1, failed: 0 };
  }

  let saved = 0;
  let failed = 0;

  const promptParams: PromptParams = {
    id: prompt.id,
    name: prompt.name,
    description: prompt.description,
    createdAt: prompt.createdAt,
  };

  if (published) {
    try {
      await sendPromptGraphRequest(
        { prompt: promptParams, versionId: published.id, value: published.value },
        "publish",
      );
      saved++;
    } catch {
      failed++;
    }
  }

  if (draft) {
    try {
      await sendPromptGraphRequest(
        { prompt: promptParams, versionId: draft.id, value: draft.value },
        "update",
      );
      saved++;
    } catch {
      failed++;
    }
  }

  return { saved, skipped: 0, failed };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const MOCK_DATE = new Date("2025-01-01T00:00:00Z");

const makePrompt = (overrides: Partial<PromptRow> = {}): PromptRow => ({
  id: "p1",
  name: "MY_PROMPT",
  description: "desc",
  createdAt: MOCK_DATE,
  publishedVersion: { id: "v-pub", value: "published content" },
  ...overrides,
});

describe("backfill per-prompt logic (default mode: published + latest draft)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendPromptGraphRequest.mockResolvedValue(undefined);
  });

  it("fires publish trigger for published version", async () => {
    const prompt = makePrompt();
    await processPrompt(prompt, null, false);

    expect(mockSendPromptGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: "v-pub", value: "published content" }),
      "publish",
    );
  });

  it("fires update trigger for latest draft", async () => {
    const prompt = makePrompt({ publishedVersion: null });
    const draft = { id: "v-draft", value: "draft content" };

    await processPrompt(prompt, draft, false);

    expect(mockSendPromptGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: "v-draft", value: "draft content" }),
      "update",
    );
  });

  it("fires both triggers when prompt has a published version AND a latest draft", async () => {
    const prompt = makePrompt();
    const draft = { id: "v-draft", value: "draft content" };

    const result = await processPrompt(prompt, draft, false);

    expect(mockSendPromptGraphRequest).toHaveBeenCalledTimes(2);
    expect(result.saved).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("skips prompt that has neither published version nor draft", async () => {
    const prompt = makePrompt({ publishedVersion: null });

    const result = await processPrompt(prompt, null, false);

    expect(mockSendPromptGraphRequest).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.saved).toBe(0);
  });

  it("increments failed and does not throw when sendPromptGraphRequest rejects", async () => {
    mockSendPromptGraphRequest.mockRejectedValueOnce(new Error("Network error"));

    const prompt = makePrompt();
    const result = await processPrompt(prompt, null, false);

    expect(result.failed).toBe(1);
    expect(result.saved).toBe(0);
  });

  it("counts saved and failed independently when one of two calls fails", async () => {
    mockSendPromptGraphRequest
      .mockResolvedValueOnce(undefined) // published succeeds
      .mockRejectedValueOnce(new Error("draft failed")); // draft fails

    const prompt = makePrompt();
    const draft = { id: "v-draft", value: "draft content" };

    const result = await processPrompt(prompt, draft, false);

    expect(result.saved).toBe(1);
    expect(result.failed).toBe(1);
  });
});

describe("backfill per-prompt logic (--published-only mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendPromptGraphRequest.mockResolvedValue(undefined);
  });

  it("only fires the published trigger, ignores draft", async () => {
    const prompt = makePrompt();
    const draft = { id: "v-draft", value: "draft content" };

    const result = await processPrompt(prompt, draft, true /* publishedOnly */);

    expect(mockSendPromptGraphRequest).toHaveBeenCalledOnce();
    expect(mockSendPromptGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: "v-pub" }),
      "publish",
    );
    expect(result.saved).toBe(1);
  });

  it("skips prompt with no published version even if draft exists", async () => {
    const prompt = makePrompt({ publishedVersion: null });
    const draft = { id: "v-draft", value: "draft content" };

    const result = await processPrompt(prompt, draft, true /* publishedOnly */);

    expect(mockSendPromptGraphRequest).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });
});

describe("backfill per-prompt logic — payload correctness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendPromptGraphRequest.mockResolvedValue(undefined);
  });

  it("passes exact prompt metadata fields to sendPromptGraphRequest", async () => {
    const prompt = makePrompt({
      id: "p-exact",
      name: "EXACT_PROMPT",
      description: "my desc",
      createdAt: MOCK_DATE,
      publishedVersion: { id: "v-exact", value: "exact value" },
    });

    await processPrompt(prompt, null, false);

    expect(mockSendPromptGraphRequest).toHaveBeenCalledWith(
      {
        prompt: {
          id: "p-exact",
          name: "EXACT_PROMPT",
          description: "my desc",
          createdAt: MOCK_DATE,
        },
        versionId: "v-exact",
        value: "exact value",
      },
      "publish",
    );
  });
});
