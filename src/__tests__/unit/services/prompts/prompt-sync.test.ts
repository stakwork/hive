/**
 * Unit tests for src/services/prompts/prompt-sync.ts
 *
 * Covers:
 * 1. sendPromptGraphRequest — exact payload shape + throws on stakworkRequest failure; guards on WORKFLOW_GRAPH_PROMPT_STORAGE_ID
 * 2. recordPromptOnGraph (via writePromptThrough / publishVersion) — swallows errors, never throws
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockStakworkRequest,
  mockDbPromptFindUnique,
  mockDbTransaction,
  mockDbPromptUpdate,
  mockDbPromptVersionCreate,
  mockDbPromptVersionAggregate,
  mockDbPromptVersionFindFirst,
  mockDbPromptVersionUpdateMany,
  mockDbPromptVersionUpdate,
  mockDbPromptCreate,
} = vi.hoisted(() => ({
  mockStakworkRequest: vi.fn(),
  mockDbPromptFindUnique: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockDbPromptUpdate: vi.fn(),
  mockDbPromptVersionCreate: vi.fn(),
  mockDbPromptVersionAggregate: vi.fn(),
  mockDbPromptVersionFindFirst: vi.fn(),
  mockDbPromptVersionUpdateMany: vi.fn(),
  mockDbPromptVersionUpdate: vi.fn(),
  mockDbPromptCreate: vi.fn(),
}));

vi.mock("@/lib/service-factory", () => ({
  stakworkService: () => ({ stakworkRequest: mockStakworkRequest }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    prompt: {
      findUnique: mockDbPromptFindUnique,
      update: mockDbPromptUpdate,
      create: mockDbPromptCreate,
      delete: vi.fn(),
    },
    promptVersion: {
      create: mockDbPromptVersionCreate,
      aggregate: mockDbPromptVersionAggregate,
      findFirst: mockDbPromptVersionFindFirst,
      updateMany: mockDbPromptVersionUpdateMany,
      update: mockDbPromptVersionUpdate,
    },
    $transaction: mockDbTransaction,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-key",
    STAKWORK_BASE_URL: "https://stakwork.test",
    WORKFLOW_GRAPH_PROMPT_STORAGE_ID: "999",
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { sendPromptGraphRequest, writePromptThrough, publishVersion } from "@/services/prompts/prompt-sync";
import { logger } from "@/lib/logger";
import { config } from "@/config/env";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_PROMPT = {
  id: "prompt-1",
  name: "MY_PROMPT",
  description: "A test prompt",
  createdAt: new Date("2025-01-01T00:00:00Z"),
};

const PARAMS = {
  prompt: BASE_PROMPT,
  versionId: "version-abc",
  value: "Hello from prompt",
  workspaceId: "workspace-1",
};

// ─── sendPromptGraphRequest ───────────────────────────────────────────────────

describe("sendPromptGraphRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls stakworkRequest with the exact payload shape", async () => {
    mockStakworkRequest.mockResolvedValueOnce({});

    await sendPromptGraphRequest(PARAMS, "publish");

    expect(mockStakworkRequest).toHaveBeenCalledOnce();
    expect(mockStakworkRequest).toHaveBeenCalledWith("/projects", {
      name: `Prompt Graph Recorder ${BASE_PROMPT.id}`,
      workflow_id: 999,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              prompt: {
                id: BASE_PROMPT.id,
                prompt_id: BASE_PROMPT.id,
                prompt_version_id: PARAMS.versionId,
                name: BASE_PROMPT.name,
                description: BASE_PROMPT.description,
                value: PARAMS.value,
                published_at: BASE_PROMPT.createdAt,
                customer_id: null,
              },
            },
          },
        },
      },
    });
  });

  it("uses empty string for description when null", async () => {
    mockStakworkRequest.mockResolvedValueOnce({});

    await sendPromptGraphRequest(
      { ...PARAMS, prompt: { ...BASE_PROMPT, description: null } },
      "create",
    );

    const call = mockStakworkRequest.mock.calls[0][1];
    expect(call.workflow_params.set_var.attributes.vars.prompt.description).toBe("");
  });

  it("throws when stakworkRequest rejects", async () => {
    mockStakworkRequest.mockRejectedValueOnce(new Error("Stakwork API down"));

    await expect(sendPromptGraphRequest(PARAMS, "update")).rejects.toThrow("Stakwork API down");
  });

  it("no-ops with warn when WORKFLOW_GRAPH_PROMPT_STORAGE_ID is unset", async () => {
    const mutableConfig = config as Record<string, unknown>;
    const original = mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID;
    mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID = undefined;

    await sendPromptGraphRequest(PARAMS, "create");

    expect(mockStakworkRequest).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("WORKFLOW_GRAPH_PROMPT_STORAGE_ID not set or non-numeric"),
      "prompt-sync",
      expect.any(Object),
    );

    mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID = original;
  });

  it("no-ops with warn when WORKFLOW_GRAPH_PROMPT_STORAGE_ID is empty string", async () => {
    const mutableConfig = config as Record<string, unknown>;
    const original = mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID;
    mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID = "";

    await sendPromptGraphRequest(PARAMS, "create");

    expect(mockStakworkRequest).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("WORKFLOW_GRAPH_PROMPT_STORAGE_ID not set or non-numeric"),
      "prompt-sync",
      expect.any(Object),
    );

    mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID = original;
  });

  it("no-ops with warn when WORKFLOW_GRAPH_PROMPT_STORAGE_ID is non-numeric (e.g. 'abc')", async () => {
    const mutableConfig = config as Record<string, unknown>;
    const original = mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID;
    mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID = "abc";

    await sendPromptGraphRequest(PARAMS, "create");

    expect(mockStakworkRequest).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("WORKFLOW_GRAPH_PROMPT_STORAGE_ID not set or non-numeric"),
      "prompt-sync",
      expect.any(Object),
    );

    mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID = original;
  });

  it("no-ops with warn when WORKFLOW_GRAPH_PROMPT_STORAGE_ID is 'NaN'", async () => {
    const mutableConfig = config as Record<string, unknown>;
    const original = mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID;
    mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID = "NaN";

    await sendPromptGraphRequest(PARAMS, "create");

    expect(mockStakworkRequest).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("WORKFLOW_GRAPH_PROMPT_STORAGE_ID not set or non-numeric"),
      "prompt-sync",
      expect.any(Object),
    );

    mutableConfig.WORKFLOW_GRAPH_PROMPT_STORAGE_ID = original;
  });
});

// ─── recordPromptOnGraph (via writePromptThrough / publishVersion) ─────────────

describe("recordPromptOnGraph (swallows errors via writePromptThrough create path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStakworkRequest.mockResolvedValue({});
  });

  it("does not throw when sendPromptGraphRequest fails during prompt creation", async () => {
    // Make graph recorder fail
    mockStakworkRequest.mockRejectedValueOnce(new Error("Graph recorder is down"));

    const mockPrompt = {
      id: "prompt-new",
      name: "NEW_PROMPT",
      value: "val",
      description: null,
      publishedVersionId: "v1",
      stakworkId: null,
      syncStatus: "OK",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const mockVersion = {
      id: "v1",
      versionNumber: 1,
      value: "val",
      description: null,
      published: true,
      createdAt: new Date(),
    };

    mockDbTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        prompt: { create: vi.fn().mockResolvedValue(mockPrompt), update: vi.fn().mockResolvedValue(mockPrompt) },
        promptVersion: { create: vi.fn().mockResolvedValue(mockVersion) },
      };
      return fn(tx);
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 42 } }),
    } as Response);

    mockDbPromptUpdate.mockResolvedValue({ ...mockPrompt, stakworkId: 42, syncStatus: "OK" });

    // Should NOT throw even though graph recorder fails
    await expect(
      writePromptThrough({
        name: "NEW_PROMPT",
        value: "val",
        userId: "user-1",
        workspaceId: "workspace-1",
      }),
    ).resolves.not.toThrow();
  });
});

describe("recordPromptOnGraph (swallows errors via publishVersion)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not throw when sendPromptGraphRequest fails during publish", async () => {
    const mockPrompt = {
      id: "prompt-1",
      name: "MY_PROMPT",
      value: "val",
      description: null,
      publishedVersionId: "v1",
      stakworkId: null,
      syncStatus: "OK",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const mockVersion = {
      id: "v2",
      promptId: "prompt-1",
      versionNumber: 2,
      value: "new val",
      description: null,
      published: false,
      createdAt: new Date(),
    };

    mockDbPromptVersionFindFirst.mockResolvedValueOnce(mockVersion);
    mockDbPromptFindUnique.mockResolvedValueOnce(mockPrompt);
    mockDbTransaction.mockResolvedValueOnce([undefined, undefined, undefined]);

    // Graph recorder stakworkRequest throws
    mockStakworkRequest.mockRejectedValueOnce(new Error("Graph recorder exploded"));

    // Should NOT throw
    await expect(publishVersion("prompt-1", "v2", "workspace-1")).resolves.not.toThrow();

    // Verify the error was swallowed (logger.warn called)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("non-fatal"),
      "prompt-sync",
      expect.objectContaining({ promptId: "prompt-1" }),
    );
  });
});

// ─── publishVersion Stakwork push ─────────────────────────────────────────────

describe("publishVersion — Stakwork push", () => {
  const mockPrompt = {
    id: "prompt-1",
    name: "MY_PROMPT",
    value: "old val",
    description: "A prompt",
    publishedVersionId: "v1",
    stakworkId: 77,
    syncStatus: "OK",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date(),
  };

  const mockVersion = {
    id: "v2",
    promptId: "prompt-1",
    versionNumber: 2,
    value: "new published value",
    description: "v2 description",
    published: false,
    createdAt: new Date(),
  };

  function setupPublishMocks(fetchResponse: Partial<Response> & { text?: () => Promise<string> }) {
    vi.clearAllMocks();
    mockStakworkRequest.mockResolvedValue({}); // graph recorder no-op
    mockDbPromptVersionFindFirst.mockResolvedValueOnce(mockVersion);
    mockDbPromptFindUnique.mockResolvedValueOnce(mockPrompt);
    mockDbTransaction.mockResolvedValueOnce([undefined, undefined, undefined]);
    mockDbPromptUpdate.mockResolvedValue(mockPrompt);
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => "",
      ...fetchResponse,
    } as Response);
  }

  it("sends full version payload including published:true on publish", async () => {
    setupPublishMocks({ ok: true });

    await publishVersion("prompt-1", "v2");

    const fetchCalls = vi.mocked(global.fetch).mock.calls;
    // Find the PUT call to the prompts endpoint
    const putCall = fetchCalls.find(
      ([url, opts]) =>
        typeof url === "string" &&
        url.includes("/prompts/77") &&
        (opts as RequestInit)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const body = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(body).toEqual({
      prompt: {
        name: "MY_PROMPT",
        value: "new published value",
        description: "v2 description",
        hive_version_id: "v2",
        published: true,
      },
    });
  });

  it("sets syncStatus OK and lastSyncedAt on successful push", async () => {
    setupPublishMocks({ ok: true });

    await publishVersion("prompt-1", "v2");

    expect(mockDbPromptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "prompt-1" },
        data: expect.objectContaining({ syncStatus: "OK", lastSyncedAt: expect.any(Date) }),
      }),
    );
  });

  it("does not throw and sets syncStatus PENDING on failed push", async () => {
    vi.clearAllMocks();
    mockStakworkRequest.mockResolvedValue({});
    mockDbPromptVersionFindFirst.mockResolvedValueOnce(mockVersion);
    mockDbPromptFindUnique.mockResolvedValueOnce(mockPrompt);
    mockDbTransaction.mockResolvedValueOnce([undefined, undefined, undefined]);
    mockDbPromptUpdate.mockResolvedValue(mockPrompt);
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as unknown as Response);

    await expect(publishVersion("prompt-1", "v2")).resolves.not.toThrow();

    expect(mockDbPromptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "prompt-1" },
        data: expect.objectContaining({ syncStatus: "PENDING" }),
      }),
    );
  });

  it("treats hive_version_id already exists as no-op success (syncStatus OK)", async () => {
    vi.clearAllMocks();
    mockStakworkRequest.mockResolvedValue({});
    mockDbPromptVersionFindFirst.mockResolvedValueOnce(mockVersion);
    mockDbPromptFindUnique.mockResolvedValueOnce(mockPrompt);
    mockDbTransaction.mockResolvedValueOnce([undefined, undefined, undefined]);
    mockDbPromptUpdate.mockResolvedValue(mockPrompt);
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => "hive_version_id already exists",
    } as unknown as Response);

    await expect(publishVersion("prompt-1", "v2")).resolves.not.toThrow();

    expect(mockDbPromptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "prompt-1" },
        data: expect.objectContaining({ syncStatus: "OK", lastSyncedAt: expect.any(Date) }),
      }),
    );
    const pendingCall = vi.mocked(mockDbPromptUpdate).mock.calls.find(
      ([args]) => args?.data?.syncStatus === "PENDING",
    );
    expect(pendingCall).toBeUndefined();
  });

  it("does not call fetch when stakworkId is null", async () => {
    vi.clearAllMocks();
    mockStakworkRequest.mockResolvedValue({});
    const promptNoStakwork = { ...mockPrompt, stakworkId: null };
    mockDbPromptVersionFindFirst.mockResolvedValueOnce(mockVersion);
    mockDbPromptFindUnique.mockResolvedValueOnce(promptNoStakwork);
    mockDbTransaction.mockResolvedValueOnce([undefined, undefined, undefined]);
    global.fetch = vi.fn();

    await publishVersion("prompt-1", "v2");

    // fetch should not have been called with a PUT to prompts
    const putCall = vi.mocked(global.fetch).mock.calls.find(
      ([url, opts]) =>
        typeof url === "string" &&
        url.includes("/prompts/") &&
        (opts as RequestInit)?.method === "PUT",
    );
    expect(putCall).toBeUndefined();
  });

  it("uses empty string for description when version description is null", async () => {
    const versionNullDesc = { ...mockVersion, description: null };
    vi.clearAllMocks();
    mockStakworkRequest.mockResolvedValue({});
    mockDbPromptVersionFindFirst.mockResolvedValueOnce(versionNullDesc);
    mockDbPromptFindUnique.mockResolvedValueOnce(mockPrompt);
    mockDbTransaction.mockResolvedValueOnce([undefined, undefined, undefined]);
    mockDbPromptUpdate.mockResolvedValue(mockPrompt);
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => "",
    } as unknown as Response);

    await publishVersion("prompt-1", "v2");

    const putCall = vi.mocked(global.fetch).mock.calls.find(
      ([url, opts]) =>
        typeof url === "string" &&
        url.includes("/prompts/77") &&
        (opts as RequestInit)?.method === "PUT",
    );
    const body = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(body.prompt.description).toBe("");
  });
});

// ─── buildStakworkPromptIndexByName ──────────────────────────────────────────

import { buildStakworkPromptIndexByName, resolveStakworkPromptId } from "@/services/prompts/prompt-sync";

describe("buildStakworkPromptIndexByName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeListPage(prompts: Array<{ id: number; name: string }>) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ data: { prompts } }),
    } as unknown as Response;
  }

  it("paginates until a short page and stops", async () => {
    // page 1: full page of 20, page 2: 3 entries (short → stop)
    const page1 = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `PROMPT_${i + 1}` }));
    const page2 = [{ id: 21, name: "PROMPT_21" }, { id: 22, name: "PROMPT_22" }, { id: 23, name: "PROMPT_23" }];

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeListPage(page1))
      .mockResolvedValueOnce(makeListPage(page2));

    const index = await buildStakworkPromptIndexByName();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(index.size).toBe(23); // 20 + 3 unique names
    expect(index.get("PROMPT_1")).toEqual([{ id: 1, name: "PROMPT_1" }]);
    expect(index.get("PROMPT_21")).toEqual([{ id: 21, name: "PROMPT_21" }]);
  });

  it("stops after a single full page when next page is empty", async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `P_${i + 1}` }));

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeListPage(page1))
      .mockResolvedValueOnce(makeListPage([]));

    const index = await buildStakworkPromptIndexByName();
    // empty page is < 20, so it stops. But also: page1 has 20 entries so we fetch page2
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(index.size).toBe(20);
  });

  it("groups duplicate-named entries into a multi-entry bucket", async () => {
    const prompts = [
      { id: 1, name: "DUP_NAME" },
      { id: 2, name: "DUP_NAME" },
      { id: 3, name: "UNIQUE" },
    ];

    global.fetch = vi.fn().mockResolvedValueOnce(makeListPage(prompts));

    const index = await buildStakworkPromptIndexByName();

    const dupBucket = index.get("DUP_NAME");
    expect(dupBucket).toHaveLength(2);
    expect(dupBucket).toEqual([
      { id: 1, name: "DUP_NAME" },
      { id: 2, name: "DUP_NAME" },
    ]);
    expect(index.get("UNIQUE")).toHaveLength(1);
  });

  it("retries on 429 with Retry-After and succeeds", async () => {
    const page1 = [{ id: 1, name: "MY_PROMPT" }];

    global.fetch = vi.fn()
      // First attempt: 429
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (h: string) => (h === "Retry-After" ? "0" : null) },
        json: async () => ({}),
      } as unknown as Response)
      // Retry (same page): success with short page → stops
      .mockResolvedValueOnce(makeListPage(page1));

    const index = await buildStakworkPromptIndexByName();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(index.get("MY_PROMPT")).toEqual([{ id: 1, name: "MY_PROMPT" }]);
  });

  it("throws on a non-ok, non-429 page response", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({}),
    } as unknown as Response);

    await expect(buildStakworkPromptIndexByName()).rejects.toThrow(
      /Stakwork GET \/prompts\?page=1 failed: 500/,
    );
  });

  it("does not log Authorization header or fetch request object", async () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValueOnce(makeListPage([{ id: 1, name: "X" }]));

    await buildStakworkPromptIndexByName();

    for (const call of [...consoleSpy.mock.calls, ...warnSpy.mock.calls]) {
      const str = JSON.stringify(call);
      expect(str).not.toContain("Authorization");
      expect(str).not.toContain("test-key");
    }

    consoleSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ─── resolveStakworkPromptId ──────────────────────────────────────────────────

describe("resolveStakworkPromptId", () => {
  const makeIndex = (entries: Array<{ id: number; name: string }>) => {
    const m = new Map<string, Array<{ id: number; name: string }>>();
    for (const e of entries) {
      const bucket = m.get(e.name) ?? [];
      bucket.push(e);
      m.set(e.name, bucket);
    }
    return m;
  };

  it("returns no-match when name is not in the index", async () => {
    const index = makeIndex([{ id: 1, name: "OTHER" }]);
    const result = await resolveStakworkPromptId({ name: "MISSING" }, index);
    expect(result).toEqual({ reason: "no-match" });
  });

  it("returns ambiguous when multiple entries share the same name", async () => {
    const index = makeIndex([
      { id: 1, name: "DUP" },
      { id: 2, name: "DUP" },
    ]);
    const result = await resolveStakworkPromptId({ name: "DUP" }, index);
    expect(result).toEqual({ reason: "ambiguous" });
  });

  it("returns { id, verified: true } when detail hive_version_id matches a known version id", async () => {
    const index = makeIndex([{ id: 42, name: "MY_PROMPT" }]);
    const fetchDetail = vi.fn().mockResolvedValue({ id: 42, name: "MY_PROMPT", hive_version_id: "ver-abc" });

    const result = await resolveStakworkPromptId(
      { name: "MY_PROMPT", versions: [{ id: "ver-abc" }, { id: "ver-def" }] },
      index,
      { fetchDetail },
    );

    expect(result).toEqual({ id: 42, verified: true });
    expect(fetchDetail).toHaveBeenCalledWith(42);
  });

  it("returns ownership-mismatch when hive_version_id is present but doesn't match any version id", async () => {
    const index = makeIndex([{ id: 99, name: "MY_PROMPT" }]);
    const fetchDetail = vi.fn().mockResolvedValue({
      id: 99,
      name: "MY_PROMPT",
      hive_version_id: "foreign-version-id",
    });

    const result = await resolveStakworkPromptId(
      { name: "MY_PROMPT", versions: [{ id: "ver-abc" }] },
      index,
      { fetchDetail },
    );

    expect(result).toEqual({ reason: "ownership-mismatch" });
  });

  it("returns { id, verified: false } when detail has no hive_version_id field", async () => {
    const index = makeIndex([{ id: 7, name: "NO_HIVE_ID" }]);
    const fetchDetail = vi.fn().mockResolvedValue({ id: 7, name: "NO_HIVE_ID", value: "some text" });

    const result = await resolveStakworkPromptId(
      { name: "NO_HIVE_ID", versions: [{ id: "ver-1" }] },
      index,
      { fetchDetail },
    );

    expect(result).toEqual({ id: 7, verified: false });
  });

  it("returns { id, verified: false } when hive_version_id is null in detail", async () => {
    const index = makeIndex([{ id: 8, name: "NULL_VER" }]);
    const fetchDetail = vi.fn().mockResolvedValue({ id: 8, hive_version_id: null });

    const result = await resolveStakworkPromptId(
      { name: "NULL_VER", versions: [] },
      index,
      { fetchDetail },
    );

    // null is treated same as absent → fallback binding
    expect(result).toEqual({ id: 8, verified: false });
  });

  it("returns { id, verified: false } when prompt has no versions array and detail lacks hive_version_id", async () => {
    const index = makeIndex([{ id: 5, name: "NO_VERSIONS" }]);
    const fetchDetail = vi.fn().mockResolvedValue({ id: 5, name: "NO_VERSIONS" });

    const result = await resolveStakworkPromptId({ name: "NO_VERSIONS" }, index, { fetchDetail });

    expect(result).toEqual({ id: 5, verified: false });
  });

  it("does not log Authorization or secrets during resolution", async () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const index = makeIndex([{ id: 1, name: "SAFE" }]);
    const fetchDetail = vi.fn().mockResolvedValue({ id: 1 });

    await resolveStakworkPromptId({ name: "SAFE" }, index, { fetchDetail });

    for (const call of [...consoleSpy.mock.calls, ...warnSpy.mock.calls]) {
      const str = JSON.stringify(call);
      expect(str).not.toContain("Authorization");
      expect(str).not.toContain("test-key");
    }

    consoleSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
