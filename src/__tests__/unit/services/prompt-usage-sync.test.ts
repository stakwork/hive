import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchPromptUsagePage,
  syncPromptUsagesForWorkspace,
  executeScheduledPromptUsageSync,
} from "@/services/prompts/prompt-usage-sync";
import { db } from "@/lib/db";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db");

const mockDecryptField = vi.fn();
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({ decryptField: mockDecryptField }),
  },
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockedDb = vi.mocked(db);
const mockedFetch = vi.fn();
global.fetch = mockedFetch;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<{
  id: number;
  prompt_name: string;
  workflow_id: number;
  step_id: string;
}> = {}) {
  return {
    id: overrides.id ?? 1,
    prompt_id: null,
    prompt_name: overrides.prompt_name ?? "MY_PROMPT",
    workflow_id: overrides.workflow_id ?? 10,
    workflow_name: "Test Workflow",
    step_id: overrides.step_id ?? "step-1",
    step_unique_id: null,
    field_path: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };
}

function makePageResponse(rows: ReturnType<typeof makeRow>[], total: number) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: { total, size: rows.length, prompt_usages: rows },
    }),
  };
}

function makeWorkspace(overrides: Partial<{ id: string; slug: string; stakworkApiKey: string | null }> = {}) {
  return {
    id: overrides.id ?? "ws-1",
    slug: overrides.slug ?? "test-workspace",
    stakworkApiKey: overrides.stakworkApiKey !== undefined ? overrides.stakworkApiKey : "encrypted-key",
  };
}

// ── fetchPromptUsagePage ──────────────────────────────────────────────────────

describe("fetchPromptUsagePage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches with correct URL and auth header", async () => {
    const row = makeRow();
    mockedFetch.mockResolvedValueOnce(makePageResponse([row], 1));

    const result = await fetchPromptUsagePage("my-token", 1);

    expect(mockedFetch).toHaveBeenCalledWith(
      "https://api.stakwork.com/api/v1/prompt_usages?page=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Token token="my-token"',
        }),
      }),
    );
    expect(result.total).toBe(1);
    expect(result.prompt_usages).toHaveLength(1);
  });

  it("throws on non-OK response", async () => {
    mockedFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" });

    await expect(fetchPromptUsagePage("bad-token", 1)).rejects.toThrow("401");
  });
});

// ── syncPromptUsagesForWorkspace ──────────────────────────────────────────────

describe("syncPromptUsagesForWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptField.mockReturnValue("decrypted-token");
    mockedDb.prompt.findMany = vi.fn().mockResolvedValue([]);
    mockedDb.promptUsage = {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    } as unknown as typeof mockedDb.promptUsage;
  });

  it("skips workspace with null stakworkApiKey", async () => {
    const ws = makeWorkspace({ stakworkApiKey: null });
    const result = await syncPromptUsagesForWorkspace(ws);
    expect(result).toEqual({ upserted: 0, pruned: 0 });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("skips workspace when decrypt throws", async () => {
    mockDecryptField.mockImplementation(() => { throw new Error("bad key"); });
    const ws = makeWorkspace();
    const result = await syncPromptUsagesForWorkspace(ws);
    expect(result).toEqual({ upserted: 0, pruned: 0 });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("skips workspace when decrypted token is empty", async () => {
    mockDecryptField.mockReturnValue("   ");
    const ws = makeWorkspace();
    const result = await syncPromptUsagesForWorkspace(ws);
    expect(result).toEqual({ upserted: 0, pruned: 0 });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("paginates until all rows are fetched", async () => {
    // Page 1: 2 rows, total = 3
    const page1Rows = [makeRow({ id: 1, step_id: "s1" }), makeRow({ id: 2, step_id: "s2" })];
    // Page 2: 1 row, accumulated = 3 >= total
    const page2Rows = [makeRow({ id: 3, step_id: "s3" })];

    mockedFetch
      .mockResolvedValueOnce(makePageResponse(page1Rows, 3))
      .mockResolvedValueOnce(makePageResponse(page2Rows, 3));

    const result = await syncPromptUsagesForWorkspace(makeWorkspace());

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("page=1"),
      expect.anything(),
    );
    expect(mockedFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("page=2"),
      expect.anything(),
    );
    expect(result.upserted).toBe(3);
  });

  it("resolves promptId for a matching Prompt.name and leaves null for unmatched", async () => {
    const row1 = makeRow({ prompt_name: "KNOWN_PROMPT", step_id: "s1" });
    const row2 = makeRow({ prompt_name: "UNKNOWN_PROMPT", step_id: "s2" });
    mockedFetch.mockResolvedValueOnce(makePageResponse([row1, row2], 2));

    mockedDb.prompt.findMany = vi.fn().mockResolvedValue([
      { id: "prompt-cuid-1", name: "KNOWN_PROMPT" },
    ]);

    await syncPromptUsagesForWorkspace(makeWorkspace());

    const upsertCalls = vi.mocked(mockedDb.promptUsage.upsert).mock.calls;
    expect(upsertCalls).toHaveLength(2);

    const known = upsertCalls.find((c) => c[0].create.promptName === "KNOWN_PROMPT");
    const unknown = upsertCalls.find((c) => c[0].create.promptName === "UNKNOWN_PROMPT");

    expect(known?.[0].create.promptId).toBe("prompt-cuid-1");
    expect(unknown?.[0].create.promptId).toBeNull();
  });

  it("upserts using the correct unique key", async () => {
    const row = makeRow({ workflow_id: 42, step_id: "step-abc", prompt_name: "FOO" });
    mockedFetch.mockResolvedValueOnce(makePageResponse([row], 1));

    await syncPromptUsagesForWorkspace(makeWorkspace({ id: "ws-xyz" }));

    expect(mockedDb.promptUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId_workflowId_stepId_promptName: {
            workspaceId: "ws-xyz",
            workflowId: 42,
            stepId: "step-abc",
            promptName: "FOO",
          },
        },
      }),
    );
  });

  it("prunes rows scoped only to the workspace being synced", async () => {
    const row = makeRow({ workflow_id: 10, step_id: "s1", prompt_name: "P" });
    mockedFetch.mockResolvedValueOnce(makePageResponse([row], 1));
    mockedDb.promptUsage.deleteMany = vi.fn().mockResolvedValue({ count: 2 });

    const result = await syncPromptUsagesForWorkspace(makeWorkspace({ id: "ws-1" }));

    const deleteCall = vi.mocked(mockedDb.promptUsage.deleteMany).mock.calls[0][0];
    // Must scope delete to the workspace
    expect(deleteCall?.where?.workspaceId).toBe("ws-1");
    expect(result.pruned).toBe(2);
  });

  it("does not prune other workspaces' rows", async () => {
    const row = makeRow({ workflow_id: 10, step_id: "s1" });
    mockedFetch.mockResolvedValueOnce(makePageResponse([row], 1));

    await syncPromptUsagesForWorkspace(makeWorkspace({ id: "ws-1" }));

    const deleteCall = vi.mocked(mockedDb.promptUsage.deleteMany).mock.calls[0][0];
    // workspaceId must be the synced workspace, never a wildcard
    expect(deleteCall?.where?.workspaceId).toBe("ws-1");
    expect(deleteCall?.where?.workspaceId).not.toBeUndefined();
  });
});

// ── executeScheduledPromptUsageSync ──────────────────────────────────────────

describe("executeScheduledPromptUsageSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptField.mockReturnValue("decrypted-token");
    mockedDb.prompt.findMany = vi.fn().mockResolvedValue([]);
    mockedDb.promptUsage = {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    } as unknown as typeof mockedDb.promptUsage;
  });

  it("processes all workspaces with stakworkApiKey", async () => {
    mockedDb.workspace.findMany = vi.fn().mockResolvedValue([
      makeWorkspace({ id: "ws-1", slug: "ws1" }),
      makeWorkspace({ id: "ws-2", slug: "ws2" }),
    ]);

    // Each workspace returns 1 row
    mockedFetch
      .mockResolvedValueOnce(makePageResponse([makeRow()], 1))
      .mockResolvedValueOnce(makePageResponse([makeRow()], 1));

    const result = await executeScheduledPromptUsageSync();

    expect(result.workspacesProcessed).toBe(2);
    expect(result.usagesUpserted).toBe(2);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("does not stop processing when one workspace's Stakwork fetch fails", async () => {
    mockedDb.workspace.findMany = vi.fn().mockResolvedValue([
      makeWorkspace({ id: "ws-1", slug: "ws1" }),
      makeWorkspace({ id: "ws-2", slug: "ws2" }),
    ]);

    // ws-1 fails, ws-2 succeeds
    mockedFetch
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" })
      .mockResolvedValueOnce(makePageResponse([makeRow()], 1));

    const result = await executeScheduledPromptUsageSync();

    expect(result.workspacesProcessed).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].workspaceSlug).toBe("ws1");
    expect(result.usagesUpserted).toBe(1); // ws-2 still succeeded
    expect(result.success).toBe(false);
  });

  it("leaves existing rows intact when Stakwork fetch fails for a workspace", async () => {
    mockedDb.workspace.findMany = vi.fn().mockResolvedValue([
      makeWorkspace({ id: "ws-fail", slug: "ws-fail" }),
    ]);

    mockedFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" });

    await executeScheduledPromptUsageSync();

    // Upsert and deleteMany must NOT be called for the failed workspace
    expect(mockedDb.promptUsage.upsert).not.toHaveBeenCalled();
    expect(mockedDb.promptUsage.deleteMany).not.toHaveBeenCalled();
  });

  it("returns timestamp and correct shape", async () => {
    mockedDb.workspace.findMany = vi.fn().mockResolvedValue([]);

    const result = await executeScheduledPromptUsageSync();

    expect(result).toMatchObject({
      success: true,
      workspacesProcessed: 0,
      usagesUpserted: 0,
      usagesPruned: 0,
      errors: [],
    });
    expect(result.timestamp).toBeInstanceOf(Date);
  });
});
