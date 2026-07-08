/**
 * Unit tests for src/services/prompts/prompt-sync.ts
 *
 * Covers:
 * 1. sendPromptGraphRequest — calls addNode with correct shape; guards on workspaceId / jarvis config
 * 2. recordPromptOnGraph (via writePromptThrough / publishVersion) — swallows errors, never throws
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockAddNode,
  mockAddEdge,
  mockGetJarvisConfig,
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
  mockAddNode: vi.fn(),
  mockAddEdge: vi.fn(),
  mockGetJarvisConfig: vi.fn(),
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

vi.mock("@/services/swarm/api/nodes", () => ({
  addNode: mockAddNode,
  addEdge: mockAddEdge,
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfig,
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
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { sendPromptGraphRequest, writePromptThrough, publishVersion } from "@/services/prompts/prompt-sync";
import { logger } from "@/lib/logger";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MOCK_JARVIS_CONFIG = { jarvisUrl: "https://jarvis.test", apiKey: "jarvis-key" };

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

  it("calls addNode with correct Prompt node shape", async () => {
    mockGetJarvisConfig.mockResolvedValueOnce(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValueOnce({ success: true, ref_id: "ref-prompt-1" });

    await sendPromptGraphRequest(PARAMS, "publish");

    expect(mockAddNode).toHaveBeenCalledOnce();
    expect(mockAddNode).toHaveBeenCalledWith(
      MOCK_JARVIS_CONFIG,
      {
        node_type: "Prompt",
        node_data: {
          id: BASE_PROMPT.id,
          name: BASE_PROMPT.name,
          description: BASE_PROMPT.description,
          body: PARAMS.value,
        },
      },
      { reprocess: true },
    );
    // PromptVersion step is TODO — addEdge must NOT be called
    expect(mockAddEdge).not.toHaveBeenCalled();
  });

  it("uses empty string for description when null", async () => {
    mockGetJarvisConfig.mockResolvedValueOnce(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValueOnce({ success: true, ref_id: "ref-prompt-1" });

    await sendPromptGraphRequest(
      { ...PARAMS, prompt: { ...BASE_PROMPT, description: null } },
      "create",
    );

    const call = mockAddNode.mock.calls[0];
    expect(call[1].node_data.description).toBe("");
  });

  it("no-ops with warn when workspaceId is absent", async () => {
    await sendPromptGraphRequest(
      { ...PARAMS, workspaceId: undefined },
      "create",
    );

    expect(mockAddNode).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("no workspaceId"),
      "prompt-sync",
      expect.any(Object),
    );
  });

  it("no-ops with warn when Jarvis config is null", async () => {
    mockGetJarvisConfig.mockResolvedValueOnce(null);

    await sendPromptGraphRequest(PARAMS, "create");

    expect(mockAddNode).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("no Jarvis config"),
      "prompt-sync",
      expect.any(Object),
    );
  });

  it("throws when addNode returns success: false", async () => {
    mockGetJarvisConfig.mockResolvedValueOnce(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValueOnce({ success: false, error: "Schema validation failed" });

    await expect(sendPromptGraphRequest(PARAMS, "update")).rejects.toThrow(
      "Failed to upsert Prompt node",
    );
  });

  it("throws when addNode returns success: true but no ref_id", async () => {
    mockGetJarvisConfig.mockResolvedValueOnce(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValueOnce({ success: true, ref_id: undefined });

    await expect(sendPromptGraphRequest(PARAMS, "update")).rejects.toThrow(
      "Failed to upsert Prompt node",
    );
  });
});

// ─── recordPromptOnGraph (via writePromptThrough / publishVersion) ─────────────

describe("recordPromptOnGraph (swallows errors via writePromptThrough create path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "ref-1" });
  });

  it("does not throw when sendPromptGraphRequest fails during prompt creation", async () => {
    // Make graph recorder fail
    mockAddNode.mockRejectedValueOnce(new Error("Graph recorder is down"));

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

    // Graph recorder addNode throws
    mockGetJarvisConfig.mockResolvedValueOnce(MOCK_JARVIS_CONFIG);
    mockAddNode.mockRejectedValueOnce(new Error("Graph recorder exploded"));

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
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "ref-1" });
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
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "ref-1" });
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
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "ref-1" });
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
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "ref-1" });
    const promptNoStakwork = { ...mockPrompt, stakworkId: null };
    mockDbPromptVersionFindFirst.mockResolvedValueOnce(mockVersion);
    mockDbPromptFindUnique.mockResolvedValueOnce(promptNoStakwork);
    mockDbTransaction.mockResolvedValueOnce([undefined, undefined, undefined]);
    global.fetch = vi.fn();

    await publishVersion("prompt-1", "v2");

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
    mockGetJarvisConfig.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockAddNode.mockResolvedValue({ success: true, ref_id: "ref-1" });
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
