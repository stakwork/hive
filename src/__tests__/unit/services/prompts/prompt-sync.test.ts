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
  mockDbPromptFindFirst,
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
  mockDbPromptFindFirst: vi.fn(),
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
      findFirst: mockDbPromptFindFirst,
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

// ─── pushCreateToStakwork id extraction (via writePromptThrough create path) ──

describe("writePromptThrough create — pushCreateToStakwork id extraction", () => {
  const basePrompt = {
    id: "prompt-new",
    name: "NEW_PROMPT",
    value: "val",
    description: null,
    agentNames: [],
    publishedVersionId: "v1",
    stakworkId: null,
    syncStatus: "OK",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const baseVersion = {
    id: "v1",
    versionNumber: 1,
    value: "val",
    description: null,
    published: true,
    createdAt: new Date(),
  };

  function setupCreateMocks(fetchJson: unknown) {
    vi.clearAllMocks();
    mockStakworkRequest.mockResolvedValue({});
    mockDbTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        prompt: {
          create: vi.fn().mockResolvedValue(basePrompt),
          update: vi.fn().mockResolvedValue(basePrompt),
        },
        promptVersion: { create: vi.fn().mockResolvedValue(baseVersion) },
      };
      return fn(tx);
    });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => fetchJson,
    } as Response);
    mockDbPromptUpdate.mockResolvedValue({ ...basePrompt, stakworkId: 42, syncStatus: "OK" });
  }

  it("1. existing data.id path still passes — stakworkId: 42, syncStatus: OK", async () => {
    setupCreateMocks({ data: { id: 42 } });

    await writePromptThrough({ name: "NEW_PROMPT", value: "val", userId: "user-1" });

    expect(mockDbPromptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "prompt-new" },
        data: expect.objectContaining({ stakworkId: 42, syncStatus: "OK" }),
      }),
    );
  });

  it("2. structured data.prompt.id path — stakworkId: 2114, syncStatus: OK", async () => {
    setupCreateMocks({ data: { message: "X created with id 2114", prompt: { id: 2114 } } });

    await writePromptThrough({ name: "NEW_PROMPT", value: "val", userId: "user-1" });

    expect(mockDbPromptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "prompt-new" },
        data: expect.objectContaining({ stakworkId: 2114, syncStatus: "OK" }),
      }),
    );
  });

  it("3. message-string fallback — data is bare string with trailing id", async () => {
    setupCreateMocks({ data: "X created with id 2114" });

    await writePromptThrough({ name: "NEW_PROMPT", value: "val", userId: "user-1" });

    expect(mockDbPromptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "prompt-new" },
        data: expect.objectContaining({ stakworkId: 2114, syncStatus: "OK" }),
      }),
    );
  });

  it("4. stringified numeric id coercion — data.prompt.id is string '2114'", async () => {
    setupCreateMocks({ data: { prompt: { id: "2114" } } });

    await writePromptThrough({ name: "NEW_PROMPT", value: "val", userId: "user-1" });

    expect(mockDbPromptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "prompt-new" },
        data: expect.objectContaining({ stakworkId: 2114, syncStatus: "OK" }),
      }),
    );
  });

  it("5. anchored regex — hive_version_id token not captured, real trailing id is", async () => {
    setupCreateMocks({ data: "hive_version_id 9, created with id 2114" });

    await writePromptThrough({ name: "NEW_PROMPT", value: "val", userId: "user-1" });

    expect(mockDbPromptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "prompt-new" },
        data: expect.objectContaining({ stakworkId: 2114, syncStatus: "OK" }),
      }),
    );
    // Must NOT have used 9
    const wrongCall = vi.mocked(mockDbPromptUpdate).mock.calls.find(
      ([args]) => args?.data?.stakworkId === 9,
    );
    expect(wrongCall).toBeUndefined();
  });

  it("6. 2xx with no id → PENDING, no OK update, warn logged, success info NOT emitted", async () => {
    setupCreateMocks({ data: "created, no number" });
    // update returns PENDING-state prompt for in-memory update
    mockDbPromptUpdate.mockResolvedValue({ ...basePrompt, syncStatus: "PENDING" });

    await writePromptThrough({ name: "NEW_PROMPT", value: "val", userId: "user-1" });

    // Must have updated to PENDING
    expect(mockDbPromptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "prompt-new" },
        data: expect.objectContaining({ syncStatus: "PENDING" }),
      }),
    );
    // Must NOT have updated to OK in any call for stakworkId
    const okWithId = vi.mocked(mockDbPromptUpdate).mock.calls.find(
      ([args]) => args?.data?.syncStatus === "OK" && "stakworkId" in (args?.data ?? {}),
    );
    expect(okWithId).toBeUndefined();
    // Warn must have been emitted for the PENDING case
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("no id could be extracted"),
      "prompt-sync",
      expect.objectContaining({ promptName: "NEW_PROMPT" }),
    );
    // Success info log must NOT have fired
    expect(vi.mocked(logger.info)).not.toHaveBeenCalledWith(
      expect.stringContaining("Stakwork push succeeded"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("7. out-of-range id → null → PENDING, no Prisma write with oversized value", async () => {
    setupCreateMocks({ data: `DEMO created with id 2147483648` }); // > INT32_MAX
    mockDbPromptUpdate.mockResolvedValue({ ...basePrompt, syncStatus: "PENDING" });

    await writePromptThrough({ name: "NEW_PROMPT", value: "val", userId: "user-1" });

    // Must be PENDING, not OK
    expect(mockDbPromptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "prompt-new" },
        data: expect.objectContaining({ syncStatus: "PENDING" }),
      }),
    );
    // Must NOT have attempted to write the oversized id
    const oversizedCall = vi.mocked(mockDbPromptUpdate).mock.calls.find(
      ([args]) => args?.data?.stakworkId === 2147483648,
    );
    expect(oversizedCall).toBeUndefined();
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

// ─── publishVersion — id-or-name / id-or-number resolution ───────────────────

describe("publishVersion — id-or-name / id-or-number resolution", () => {
  const mockPrompt = {
    id: "prompt-1",
    name: "MY_PROMPT",
    value: "old val",
    description: "A prompt",
    publishedVersionId: "v1",
    stakworkId: null,
    syncStatus: "OK",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date(),
  };

  const mockVersion = {
    id: "v2",
    promptId: "prompt-1",
    versionNumber: 2,
    value: "new published value",
    description: null,
    published: false,
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStakworkRequest.mockResolvedValue({});
    mockDbTransaction.mockResolvedValue([undefined, undefined, undefined]);
    mockDbPromptUpdate.mockResolvedValue(mockPrompt);
  });

  it("resolves prompt by id (cuid callers unchanged — id branch)", async () => {
    mockDbPromptFindUnique.mockResolvedValueOnce(mockPrompt);
    mockDbPromptVersionFindFirst.mockResolvedValueOnce(mockVersion);

    await expect(publishVersion("prompt-1", "v2")).resolves.not.toThrow();

    // findUnique used (id branch); findFirst for prompt NOT called
    expect(mockDbPromptFindUnique).toHaveBeenCalledWith({ where: { id: "prompt-1" } });
    expect(mockDbPromptFindFirst).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ name: expect.anything() }),
    }));
  });

  it("resolves prompt by name when id lookup misses", async () => {
    mockDbPromptFindUnique.mockResolvedValueOnce(null); // id miss
    mockDbPromptFindFirst.mockResolvedValueOnce(mockPrompt); // name hit
    mockDbPromptVersionFindFirst.mockResolvedValueOnce(mockVersion);

    await expect(publishVersion("MY_PROMPT", "v2")).resolves.not.toThrow();

    expect(mockDbPromptFindUnique).toHaveBeenCalledWith({ where: { id: "MY_PROMPT" } });
    expect(mockDbPromptFindFirst).toHaveBeenCalledWith({ where: { name: "MY_PROMPT" } });
    // Info log for name-based resolution
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.stringContaining("resolved by name"),
      "prompt-sync",
      expect.objectContaining({ resolvedName: "MY_PROMPT" }),
    );
  });

  it("resolves version by versionNumber when id lookup misses and arg is purely numeric", async () => {
    mockDbPromptFindUnique.mockResolvedValueOnce(mockPrompt);
    // id miss, then number hit
    mockDbPromptVersionFindFirst
      .mockResolvedValueOnce(null)         // id lookup miss
      .mockResolvedValueOnce(mockVersion); // versionNumber hit

    await expect(publishVersion("prompt-1", "2")).resolves.not.toThrow();

    // Second call uses versionNumber
    expect(mockDbPromptVersionFindFirst).toHaveBeenNthCalledWith(2, {
      where: { promptId: "prompt-1", versionNumber: 2 },
    });
    // Info log for number-based resolution
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.stringContaining("resolved by versionNumber"),
      "prompt-sync",
      expect.objectContaining({ versionNumber: 2 }),
    );
  });

  it("numeric-guard: cuid that looks numeric does not spuriously hit the versionNumber branch", async () => {
    // "123" is a purely numeric string — but if id lookup succeeds first, number branch is skipped
    const versionWithNumericLikeId = { ...mockVersion, id: "123" };
    mockDbPromptFindUnique.mockResolvedValueOnce(mockPrompt);
    mockDbPromptVersionFindFirst.mockResolvedValueOnce(versionWithNumericLikeId); // id hit first

    await expect(publishVersion("prompt-1", "123")).resolves.not.toThrow();

    // findFirst called only once (id branch succeeded)
    expect(mockDbPromptVersionFindFirst).toHaveBeenCalledTimes(1);
    expect(mockDbPromptVersionFindFirst).toHaveBeenCalledWith({
      where: { id: "123", promptId: "prompt-1" },
    });
  });

  it("both-invalid: neither prompt id/name match → throws 'Prompt not found' 404", async () => {
    mockDbPromptFindUnique.mockResolvedValueOnce(null);
    mockDbPromptFindFirst.mockResolvedValueOnce(null);

    await expect(publishVersion("nonexistent", "v2")).rejects.toMatchObject({
      message: "Prompt not found",
      status: 404,
    });
    // Version lookup never reached
    expect(mockDbPromptVersionFindFirst).not.toHaveBeenCalled();
  });

  it("valid prompt + bad version → throws 'Version not found' 404", async () => {
    mockDbPromptFindUnique.mockResolvedValueOnce(mockPrompt);
    mockDbPromptVersionFindFirst.mockResolvedValueOnce(null); // id miss
    // "vbad" is not purely numeric → no number fallback

    await expect(publishVersion("prompt-1", "vbad")).rejects.toMatchObject({
      message: "Version not found",
      status: 404,
    });
  });

  it("valid prompt + bad numeric version → throws 'Version not found' 404", async () => {
    mockDbPromptFindUnique.mockResolvedValueOnce(mockPrompt);
    mockDbPromptVersionFindFirst
      .mockResolvedValueOnce(null) // id miss
      .mockResolvedValueOnce(null); // number miss

    await expect(publishVersion("prompt-1", "999")).rejects.toMatchObject({
      message: "Version not found",
      status: 404,
    });
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

// ─── publishVersion — actor / attribution ─────────────────────────────────────

describe("publishVersion — actor attribution", () => {
  const mockPrompt = {
    id: "prompt-1",
    name: "MY_PROMPT",
    value: "old val",
    description: "A prompt",
    publishedVersionId: "v1",
    stakworkId: null,
    syncStatus: "OK",
    createdAt: new Date("2025-01-01T00:00:00Z"),
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockStakworkRequest.mockResolvedValue({});
    mockDbPromptFindUnique.mockResolvedValueOnce(mockPrompt);
    mockDbPromptVersionFindFirst.mockResolvedValueOnce(mockVersion);
    mockDbTransaction.mockResolvedValue([undefined, undefined, undefined]);
    mockDbPromptUpdate.mockResolvedValue(mockPrompt);
  });

  it("persists actor to publishedBy and sets publishedAt in the transaction", async () => {
    await publishVersion("prompt-1", "v2", undefined, "user-abc");

    expect(mockDbTransaction).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          // This is the db.promptVersion.update call — Prisma batches ops as an array
        }),
      ])
    );
    // The update to the target version must include publishedBy and publishedAt
    expect(mockDbPromptVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "v2" },
        data: expect.objectContaining({
          published: true,
          publishedBy: "user-abc",
          publishedAt: expect.any(Date),
        }),
      })
    );
  });

  it("persists API_TOKEN_ACTOR as publishedBy for token-authenticated publish", async () => {
    await publishVersion("prompt-1", "v2", undefined, "api-token");

    expect(mockDbPromptVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "v2" },
        data: expect.objectContaining({ publishedBy: "api-token" }),
      })
    );
  });

  it("leaves publishedBy null when actor is omitted (backward compatibility)", async () => {
    await publishVersion("prompt-1", "v2");

    expect(mockDbPromptVersionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "v2" },
        data: expect.objectContaining({ publishedBy: null }),
      })
    );
  });

  it("unpublish step (updateMany) does NOT include publishedBy — sibling attribution is preserved", async () => {
    await publishVersion("prompt-1", "v2", undefined, "user-abc");

    expect(mockDbPromptVersionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { promptId: "prompt-1" },
        data: expect.objectContaining({ published: false }),
      })
    );
    // The updateMany data must NOT contain publishedBy — it would overwrite sibling attribution
    const updateManyCall = mockDbPromptVersionUpdateMany.mock.calls[0][0];
    expect(updateManyCall.data).not.toHaveProperty("publishedBy");
    expect(updateManyCall.data).not.toHaveProperty("publishedAt");
  });

  it("includes actor in the log line", async () => {
    await publishVersion("prompt-1", "v2", undefined, "user-abc");

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "[prompt-sync] Version published",
      "prompt-sync",
      expect.objectContaining({ actor: "user-abc" }),
    );
  });

  it("logs actor as null when omitted", async () => {
    await publishVersion("prompt-1", "v2");

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "[prompt-sync] Version published",
      "prompt-sync",
      expect.objectContaining({ actor: null }),
    );
  });
});
