import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchPromptUsagePage,
  syncPromptUsagesForWorkspace,
  syncPromptUsagesForWorkspaceWithDecryptedKey,
  syncPromptUsagesGlobal,
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
    STAKWORK_API_KEY: "global-env-token",
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

function makeRow(
  overrides: Partial<{
    id: number;
    prompt_name: string;
    workflow_id: number;
    step_id: string;
  }> = {},
) {
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

function makeWorkspace(
  overrides: Partial<{ id: string; slug: string; stakworkApiKey: string | null }> = {},
) {
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
    mockedDb.prompt.findMany = vi.fn().mockResolvedValue([]);
    mockedDb.promptUsage = {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    } as unknown as typeof mockedDb.promptUsage;
  });

  it("paginates until all rows are fetched", async () => {
    const page1Rows = [makeRow({ id: 1, step_id: "s1" }), makeRow({ id: 2, step_id: "s2" })];
    const page2Rows = [makeRow({ id: 3, step_id: "s3" })];

    mockedFetch
      .mockResolvedValueOnce(makePageResponse(page1Rows, 3))
      .mockResolvedValueOnce(makePageResponse(page2Rows, 3));

    const result = await syncPromptUsagesForWorkspace(makeWorkspace(), "plain-token");

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch).toHaveBeenNthCalledWith(1, expect.stringContaining("page=1"), expect.anything());
    expect(mockedFetch).toHaveBeenNthCalledWith(2, expect.stringContaining("page=2"), expect.anything());
    expect(result.upserted).toBe(3);
  });

  it("resolves promptId for a matching Prompt.name and leaves null for unmatched", async () => {
    const row1 = makeRow({ prompt_name: "KNOWN_PROMPT", step_id: "s1" });
    const row2 = makeRow({ prompt_name: "UNKNOWN_PROMPT", step_id: "s2" });
    mockedFetch.mockResolvedValueOnce(makePageResponse([row1, row2], 2));

    mockedDb.prompt.findMany = vi.fn().mockResolvedValue([{ id: "prompt-cuid-1", name: "KNOWN_PROMPT" }]);

    await syncPromptUsagesForWorkspace(makeWorkspace(), "plain-token");

    const upsertCalls = vi.mocked(mockedDb.promptUsage.upsert).mock.calls;
    expect(upsertCalls).toHaveLength(2);

    const known = upsertCalls.find((c) => c[0].create.promptName === "KNOWN_PROMPT");
    const unknown = upsertCalls.find((c) => c[0].create.promptName === "UNKNOWN_PROMPT");

    expect(known?.[0].create.promptId).toBe("prompt-cuid-1");
    expect(unknown?.[0].create.promptId).toBeNull();
  });

  it("upserts using the correct composite unique key", async () => {
    const row = makeRow({ workflow_id: 42, step_id: "step-abc", prompt_name: "FOO" });
    mockedFetch.mockResolvedValueOnce(makePageResponse([row], 1));

    await syncPromptUsagesForWorkspace(makeWorkspace({ id: "ws-xyz" }), "plain-token");

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

    const result = await syncPromptUsagesForWorkspace(makeWorkspace({ id: "ws-1" }), "plain-token");

    const deleteCall = vi.mocked(mockedDb.promptUsage.deleteMany).mock.calls[0][0];
    expect(deleteCall?.where?.workspaceId).toBe("ws-1");
    expect(result.pruned).toBe(2);
  });

  it("does not prune other workspaces' rows", async () => {
    const row = makeRow({ workflow_id: 10, step_id: "s1" });
    mockedFetch.mockResolvedValueOnce(makePageResponse([row], 1));

    await syncPromptUsagesForWorkspace(makeWorkspace({ id: "ws-1" }), "plain-token");

    const deleteCall = vi.mocked(mockedDb.promptUsage.deleteMany).mock.calls[0][0];
    expect(deleteCall?.where?.workspaceId).toBe("ws-1");
    expect(deleteCall?.where?.workspaceId).not.toBeUndefined();
  });
});

// ── syncPromptUsagesForWorkspaceWithDecryptedKey ──────────────────────────────

describe("syncPromptUsagesForWorkspaceWithDecryptedKey", () => {
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
    const result = await syncPromptUsagesForWorkspaceWithDecryptedKey(ws);
    expect(result).toEqual({ upserted: 0, pruned: 0 });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("skips workspace when decrypt throws", async () => {
    mockDecryptField.mockImplementation(() => {
      throw new Error("bad key");
    });
    const ws = makeWorkspace();
    const result = await syncPromptUsagesForWorkspaceWithDecryptedKey(ws);
    expect(result).toEqual({ upserted: 0, pruned: 0 });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("skips workspace when decrypted token is empty", async () => {
    mockDecryptField.mockReturnValue("   ");
    const ws = makeWorkspace();
    const result = await syncPromptUsagesForWorkspaceWithDecryptedKey(ws);
    expect(result).toEqual({ upserted: 0, pruned: 0 });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("decrypts key and delegates to syncPromptUsagesForWorkspace end-to-end", async () => {
    mockDecryptField.mockReturnValue("decrypted-token");
    const row = makeRow({ workflow_id: 7, step_id: "s7", prompt_name: "MY_PROMPT" });
    mockedFetch.mockResolvedValueOnce(makePageResponse([row], 1));

    const ws = makeWorkspace({ id: "ws-dec", slug: "dec-workspace" });
    const result = await syncPromptUsagesForWorkspaceWithDecryptedKey(ws);

    // Fetch should have been called with the decrypted token
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("prompt_usages"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Token token="decrypted-token"',
        }),
      }),
    );
    // Upsert should use workspace id
    expect(mockedDb.promptUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId_workflowId_stepId_promptName: expect.objectContaining({ workspaceId: "ws-dec" }),
        }),
      }),
    );
    expect(result.upserted).toBe(1);
  });
});

// ── syncPromptUsagesGlobal ────────────────────────────────────────────────────

describe("syncPromptUsagesGlobal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.prompt.findMany = vi.fn().mockResolvedValue([]);
    mockedDb.promptUsage = {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    } as unknown as typeof mockedDb.promptUsage;
  });

  it("upserts rows with workspaceId: null (create path when row does not exist)", async () => {
    const row = makeRow({ workflow_id: 10, step_id: "s1", prompt_name: "GLOBAL_PROMPT" });
    mockedFetch.mockResolvedValueOnce(makePageResponse([row], 1));
    vi.mocked(mockedDb.promptUsage.findFirst).mockResolvedValue(null);

    const result = await syncPromptUsagesGlobal("env-token");

    expect(mockedDb.promptUsage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: null, workflowId: 10, stepId: "s1" }),
      }),
    );
    expect(mockedDb.promptUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: null, promptName: "GLOBAL_PROMPT" }),
      }),
    );
    expect(mockedDb.promptUsage.update).not.toHaveBeenCalled();
    expect(result.upserted).toBe(1);
  });

  it("updates existing row when one already exists (idempotency — update path)", async () => {
    const row = makeRow({ workflow_id: 10, step_id: "s1", prompt_name: "GLOBAL_PROMPT" });
    mockedFetch.mockResolvedValueOnce(makePageResponse([row], 1));
    vi.mocked(mockedDb.promptUsage.findFirst).mockResolvedValue({ id: "existing-id" } as never);

    const result = await syncPromptUsagesGlobal("env-token");

    expect(mockedDb.promptUsage.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "existing-id" } }),
    );
    expect(mockedDb.promptUsage.create).not.toHaveBeenCalled();
    expect(result.upserted).toBe(1);
  });

  it("prunes global rows no longer present upstream", async () => {
    const row = makeRow({ workflow_id: 10, step_id: "s1", prompt_name: "P" });
    mockedFetch.mockResolvedValueOnce(makePageResponse([row], 1));
    vi.mocked(mockedDb.promptUsage.deleteMany).mockResolvedValue({ count: 3 } as never);

    const result = await syncPromptUsagesGlobal("env-token");

    const deleteCall = vi.mocked(mockedDb.promptUsage.deleteMany).mock.calls[0][0];
    // Must scope prune to null workspace
    expect(deleteCall?.where?.workspaceId).toBeNull();
    expect(result.pruned).toBe(3);
  });

  it("resolves promptId by name for global rows", async () => {
    const row = makeRow({ prompt_name: "KNOWN_PROMPT", step_id: "s1" });
    mockedFetch.mockResolvedValueOnce(makePageResponse([row], 1));
    mockedDb.prompt.findMany = vi.fn().mockResolvedValue([{ id: "pid-1", name: "KNOWN_PROMPT" }]);
    vi.mocked(mockedDb.promptUsage.findFirst).mockResolvedValue(null);

    await syncPromptUsagesGlobal("env-token");

    expect(mockedDb.promptUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ promptId: "pid-1" }),
      }),
    );
  });

  it("paginates until all rows are fetched", async () => {
    const page1 = [makeRow({ id: 1, step_id: "s1" }), makeRow({ id: 2, step_id: "s2" })];
    const page2 = [makeRow({ id: 3, step_id: "s3" })];
    mockedFetch
      .mockResolvedValueOnce(makePageResponse(page1, 3))
      .mockResolvedValueOnce(makePageResponse(page2, 3));
    vi.mocked(mockedDb.promptUsage.findFirst).mockResolvedValue(null);

    const result = await syncPromptUsagesGlobal("env-token");

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(result.upserted).toBe(3);
  });
});

// ── executeScheduledPromptUsageSync ──────────────────────────────────────────

describe("executeScheduledPromptUsageSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.prompt.findMany = vi.fn().mockResolvedValue([]);
    mockedDb.promptUsage = {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    } as unknown as typeof mockedDb.promptUsage;
  });

  it("performs a single global pull using the env STAKWORK_API_KEY", async () => {
    mockedFetch.mockResolvedValueOnce(makePageResponse([makeRow()], 1));

    const result = await executeScheduledPromptUsageSync();

    // Only one fetch call (no workspace loop)
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("prompt_usages"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Token token="global-env-token"',
        }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.scope).toBe("global");
    expect(result.workspacesProcessed).toBe(0);
    expect(result.usagesUpserted).toBe(1);
  });

  it("stores rows with workspaceId: null during global pull", async () => {
    mockedFetch.mockResolvedValueOnce(makePageResponse([makeRow({ step_id: "s1" })], 1));
    vi.mocked(mockedDb.promptUsage.findFirst).mockResolvedValue(null);

    await executeScheduledPromptUsageSync();

    expect(mockedDb.promptUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: null }),
      }),
    );
  });

  it("prunes with workspaceId: null scope during global pull", async () => {
    mockedFetch.mockResolvedValueOnce(makePageResponse([makeRow()], 1));

    await executeScheduledPromptUsageSync();

    const deleteCall = vi.mocked(mockedDb.promptUsage.deleteMany).mock.calls[0][0];
    expect(deleteCall?.where?.workspaceId).toBeNull();
  });

  it("returns success=false and descriptive error when STAKWORK_API_KEY is missing", async () => {
    // Temporarily override config to have no key
    const { config: configMod } = await import("@/config/env");
    const originalKey = configMod.STAKWORK_API_KEY;
    (configMod as Record<string, unknown>).STAKWORK_API_KEY = "";

    const result = await executeScheduledPromptUsageSync();

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/STAKWORK_API_KEY/i);
    expect(mockedFetch).not.toHaveBeenCalled();

    // Restore
    (configMod as Record<string, unknown>).STAKWORK_API_KEY = originalKey;
  });

  it("returns timestamp and correct shape", async () => {
    mockedFetch.mockResolvedValueOnce(makePageResponse([], 0));

    const result = await executeScheduledPromptUsageSync();

    expect(result).toMatchObject({
      success: true,
      workspacesProcessed: 0,
      usagesUpserted: 0,
      usagesPruned: 0,
      scope: "global",
      errors: [],
    });
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("returns success=false when the global Stakwork fetch fails", async () => {
    mockedFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });

    const result = await executeScheduledPromptUsageSync();

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].workspaceSlug).toBe("global");
    // No DB writes should have happened
    expect(mockedDb.promptUsage.create).not.toHaveBeenCalled();
    expect(mockedDb.promptUsage.deleteMany).not.toHaveBeenCalled();
  });

  it("does not loop over workspaces (db.workspace.findMany is never called)", async () => {
    mockedDb.workspace = {
      findMany: vi.fn(),
    } as unknown as typeof mockedDb.workspace;
    mockedFetch.mockResolvedValueOnce(makePageResponse([], 0));

    await executeScheduledPromptUsageSync();

    expect(mockedDb.workspace.findMany).not.toHaveBeenCalled();
  });
});
