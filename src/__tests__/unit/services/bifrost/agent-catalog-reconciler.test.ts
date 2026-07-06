import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ensureBifrostAgentCatalog } from "@/services/bifrost/agent-catalog-reconciler";
import type { BifrostPluginClient } from "@/services/bifrost/BifrostPluginClient";
import { BifrostHttpError } from "@/services/bifrost/BifrostClient";
import { dbMock } from "@/__tests__/support/mocks/prisma";
import type { createApiKey } from "@/lib/api-keys";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/locks/redis-lock", () => ({
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  LockAcquireTimeoutError: class LockAcquireTimeoutError extends Error {},
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((_field: string, input: unknown) => {
        // Handles both plain strings and the JSON-envelope form used by
        // EncryptionService in production.
        if (typeof input === "string") {
          try {
            const parsed = JSON.parse(input);
            if (typeof parsed?.data === "string") return parsed.data;
          } catch {
            return input;
          }
          return input;
        }
        if (input && typeof input === "object") {
          const v = (input as { data?: unknown }).data;
          if (typeof v === "string") return v;
        }
        throw new Error("Invalid encrypted data format");
      }),
    })),
  },
}));

vi.mock("@/services/bifrost/resolve", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/bifrost/resolve")
  >("@/services/bifrost/resolve");
  return {
    ...actual,
    deriveBifrostBaseUrl: vi.fn(() => "http://bifrost.test:8181"),
  };
});

// agent-catalog helpers: return a deterministic manifest so the hash is
// stable across test runs. We don't care about the manifest contents here.
vi.mock("@/services/bifrost/agent-catalog", () => ({
  loadAgentPromptNames: vi.fn(async () => ({})),
  buildAgentCatalogManifest: vi.fn(() => ({
    source: "hive",
    agents: [{ name: "repo-agent" }],
  })),
  agentCatalogManifestHash: vi.fn(() => "hash-abc123"),
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKSPACE_ID = "ws-test";
const USER_ID = "u_alice";
const ENCRYPTED_TOKEN = JSON.stringify({ data: "provisioning-secret-plain" });
const SWARM_URL = "https://swarm.test";
const HASH = "hash-abc123";
const MINTED_KEY_ID = "key-id-001";
const MINTED_RAW_KEY = "hive_ws-t_aabbcc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PluginClientStub = {
  seedAgentCatalog: ReturnType<typeof vi.fn>;
  pushHiveCallback: ReturnType<typeof vi.fn>;
  getTrustStatus: ReturnType<typeof vi.fn>;
  getTrustOrg: ReturnType<typeof vi.fn>;
  upsertTrust: ReturnType<typeof vi.fn>;
  setRealmId: ReturnType<typeof vi.fn>;
};

function makePluginClient(
  overrides: Partial<PluginClientStub> = {},
): BifrostPluginClient {
  return {
    seedAgentCatalog: vi
      .fn()
      .mockResolvedValue({ written: { agents: 1, prompts: 0, tools: 0, skills: 0 } }),
    pushHiveCallback: vi.fn().mockResolvedValue({ ok: true }),
    getTrustStatus: vi.fn(),
    getTrustOrg: vi.fn(),
    upsertTrust: vi.fn(),
    setRealmId: vi.fn().mockResolvedValue({ ok: true, realm_id: "" }),
    ...overrides,
  } as unknown as BifrostPluginClient;
}

function makeCreateApiKeyFn(
  overrides: Partial<{ id: string; key: string }> = {},
): typeof createApiKey {
  return vi.fn().mockResolvedValue({
    id: overrides.id ?? MINTED_KEY_ID,
    name: "gateway-evals",
    keyPrefix: "hive_ws-t",
    key: overrides.key ?? MINTED_RAW_KEY,
    createdAt: new Date(),
    expiresAt: null,
  });
}

/** Default swarm row for a fresh (unprovisioned) swarm. */
function freshSwarm(overrides: Record<string, unknown> = {}) {
  return {
    swarmUrl: SWARM_URL,
    swarmApiKey: ENCRYPTED_TOKEN,
    bifrostAgentsSeedHash: null,
    gatewayHiveKeyId: null,
    ...overrides,
  };
}

const ORIGINAL_HIVE_PUBLIC_URL = process.env.HIVE_PUBLIC_URL;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ensureBifrostAgentCatalog — callback provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HIVE_PUBLIC_URL = "https://hive.example.com";
  });

  afterEach(() => {
    if (ORIGINAL_HIVE_PUBLIC_URL === undefined) {
      delete process.env.HIVE_PUBLIC_URL;
    } else {
      process.env.HIVE_PUBLIC_URL = ORIGINAL_HIVE_PUBLIC_URL;
    }
  });

  // -------------------------------------------------------------------------
  // Mint-once
  // -------------------------------------------------------------------------

  it("mints a key and pushes callback on first reconcile (fresh seed)", async () => {
    // Outer findUnique: fresh swarm, no hash → goes into lock
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce(freshSwarm() as never) // outer
      .mockResolvedValueOnce(freshSwarm() as never); // re-check inside lock

    vi.mocked(dbMock.swarm.update).mockResolvedValue({} as never);

    const createApiKeyFn = makeCreateApiKeyFn();
    const client = makePluginClient();

    const result = await ensureBifrostAgentCatalog(WORKSPACE_ID, USER_ID, {
      pluginClientFactory: () => client,
      createApiKeyFn,
    });

    expect(result.status).toBe("seeded");
    expect(createApiKeyFn).toHaveBeenCalledOnce();
    expect(createApiKeyFn).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      name: "gateway-evals",
      createdById: USER_ID,
    });
    expect(client.pushHiveCallback).toHaveBeenCalledOnce();
    expect(client.pushHiveCallback).toHaveBeenCalledWith({
      hive_url: "https://hive.example.com",
      api_key: MINTED_RAW_KEY,
    });
    // gatewayHiveKeyId persisted after push
    const updateCalls = vi.mocked(dbMock.swarm.update).mock.calls;
    const callbackPersist = updateCalls.find(
      (c) => (c[0] as { data: Record<string, unknown> }).data?.gatewayHiveKeyId,
    );
    expect(callbackPersist).toBeDefined();
    expect((callbackPersist![0] as { data: Record<string, unknown> }).data.gatewayHiveKeyId).toBe(MINTED_KEY_ID);
  });

  it("skips provisioning on second reconcile when key is valid (mint-once)", async () => {
    // Outer findUnique: swarm already has hash AND gatewayHiveKeyId set → "cached" path
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce(
      freshSwarm({ bifrostAgentsSeedHash: HASH, gatewayHiveKeyId: MINTED_KEY_ID }) as never,
    );
    // workspaceApiKey.findUnique: key exists and is not revoked
    vi.mocked(dbMock.workspaceApiKey.findUnique).mockResolvedValueOnce({
      id: MINTED_KEY_ID,
      revokedAt: null,
    } as never);

    const createApiKeyFn = makeCreateApiKeyFn();
    const client = makePluginClient();

    const result = await ensureBifrostAgentCatalog(WORKSPACE_ID, USER_ID, {
      pluginClientFactory: () => client,
      createApiKeyFn,
    });

    expect(result.status).toBe("cached");
    expect(createApiKeyFn).not.toHaveBeenCalled();
    expect(client.pushHiveCallback).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Re-mint on missing/revoked key
  // -------------------------------------------------------------------------

  it("re-mints and re-pushes when the remembered key row is missing", async () => {
    // Swarm has a key id but it no longer exists in DB
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce(
      freshSwarm({ bifrostAgentsSeedHash: HASH, gatewayHiveKeyId: "old-key-id" }) as never,
    );
    // workspaceApiKey.findUnique: key not found → null
    vi.mocked(dbMock.workspaceApiKey.findUnique).mockResolvedValueOnce(null);
    vi.mocked(dbMock.swarm.update).mockResolvedValue({} as never);

    const createApiKeyFn = makeCreateApiKeyFn({ id: "new-key-id" });
    const client = makePluginClient();

    const result = await ensureBifrostAgentCatalog(WORKSPACE_ID, USER_ID, {
      pluginClientFactory: () => client,
      createApiKeyFn,
    });

    expect(result.status).toBe("cached");
    expect(createApiKeyFn).toHaveBeenCalledOnce();
    expect(client.pushHiveCallback).toHaveBeenCalledOnce();
    const updateCalls = vi.mocked(dbMock.swarm.update).mock.calls;
    const callbackPersist = updateCalls.find(
      (c) => (c[0] as { data: Record<string, unknown> }).data?.gatewayHiveKeyId,
    );
    expect(
      (callbackPersist![0] as { data: Record<string, unknown> }).data.gatewayHiveKeyId,
    ).toBe("new-key-id");
  });

  it("re-mints and re-pushes when the remembered key is revoked", async () => {
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce(
      freshSwarm({ bifrostAgentsSeedHash: HASH, gatewayHiveKeyId: "revoked-key-id" }) as never,
    );
    // workspaceApiKey.findUnique: key exists but is revoked
    vi.mocked(dbMock.workspaceApiKey.findUnique).mockResolvedValueOnce({
      id: "revoked-key-id",
      revokedAt: new Date("2025-01-01"),
    } as never);
    vi.mocked(dbMock.swarm.update).mockResolvedValue({} as never);

    const createApiKeyFn = makeCreateApiKeyFn({ id: "fresh-key-id" });
    const client = makePluginClient();

    const result = await ensureBifrostAgentCatalog(WORKSPACE_ID, USER_ID, {
      pluginClientFactory: () => client,
      createApiKeyFn,
    });

    expect(result.status).toBe("cached");
    expect(createApiKeyFn).toHaveBeenCalledOnce();
    expect(client.pushHiveCallback).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Non-fatal push failure
  // -------------------------------------------------------------------------

  it("does NOT throw and does NOT persist gatewayHiveKeyId when pushHiveCallback rejects", async () => {
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce(freshSwarm() as never)
      .mockResolvedValueOnce(freshSwarm() as never);
    vi.mocked(dbMock.swarm.update).mockResolvedValue({} as never);

    const createApiKeyFn = makeCreateApiKeyFn();
    const client = makePluginClient({
      pushHiveCallback: vi.fn().mockRejectedValue(new Error("network error")),
    });

    // Must not throw
    const result = await ensureBifrostAgentCatalog(WORKSPACE_ID, USER_ID, {
      pluginClientFactory: () => client,
      createApiKeyFn,
    });

    expect(result.status).toBe("seeded");

    // gatewayHiveKeyId must NOT have been persisted
    const updateCalls = vi.mocked(dbMock.swarm.update).mock.calls;
    const hasCallbackPersist = updateCalls.some(
      (c) => (c[0] as { data: Record<string, unknown> }).data?.gatewayHiveKeyId,
    );
    expect(hasCallbackPersist).toBe(false);
  });

  it("does NOT throw when pushHiveCallback returns ok=false", async () => {
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce(freshSwarm() as never)
      .mockResolvedValueOnce(freshSwarm() as never);
    vi.mocked(dbMock.swarm.update).mockResolvedValue({} as never);

    const createApiKeyFn = makeCreateApiKeyFn();
    const client = makePluginClient({
      pushHiveCallback: vi.fn().mockResolvedValue({ ok: false }),
    });

    const result = await ensureBifrostAgentCatalog(WORKSPACE_ID, USER_ID, {
      pluginClientFactory: () => client,
      createApiKeyFn,
    });

    expect(result.status).toBe("seeded");

    const updateCalls = vi.mocked(dbMock.swarm.update).mock.calls;
    const hasCallbackPersist = updateCalls.some(
      (c) => (c[0] as { data: Record<string, unknown> }).data?.gatewayHiveKeyId,
    );
    expect(hasCallbackPersist).toBe(false);
  });

  // -------------------------------------------------------------------------
  // HIVE_PUBLIC_URL sourcing
  // -------------------------------------------------------------------------

  it("uses HIVE_PUBLIC_URL from env (not localhost) as hive_url", async () => {
    process.env.HIVE_PUBLIC_URL = "https://custom.hive.company.com";

    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce(freshSwarm() as never)
      .mockResolvedValueOnce(freshSwarm() as never);
    vi.mocked(dbMock.swarm.update).mockResolvedValue({} as never);

    const createApiKeyFn = makeCreateApiKeyFn();
    const client = makePluginClient();

    await ensureBifrostAgentCatalog(WORKSPACE_ID, USER_ID, {
      pluginClientFactory: () => client,
      createApiKeyFn,
    });

    expect(client.pushHiveCallback).toHaveBeenCalledWith(
      expect.objectContaining({ hive_url: "https://custom.hive.company.com" }),
    );
  });

  it("skips callback provisioning when HIVE_PUBLIC_URL is unset", async () => {
    delete process.env.HIVE_PUBLIC_URL;
    // Force optionalEnvVars to pick up the unset value
    // (env config caches at module-load time, so we patch the env var
    //  and rely on the reconciler reading process.env directly via
    //  optionalEnvVars which is re-evaluated each call in tests via
    //  the config module — or we just confirm pushHiveCallback is never
    //  called, which covers the intent).

    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce(freshSwarm() as never)
      .mockResolvedValueOnce(freshSwarm() as never);
    vi.mocked(dbMock.swarm.update).mockResolvedValue({} as never);

    const createApiKeyFn = makeCreateApiKeyFn();
    const client = makePluginClient();

    const result = await ensureBifrostAgentCatalog(WORKSPACE_ID, USER_ID, {
      pluginClientFactory: () => client,
      createApiKeyFn,
    });

    // Seed still succeeds; callback push is skipped
    expect(result.status).toBe("seeded");
    expect(client.pushHiveCallback).not.toHaveBeenCalled();
    expect(createApiKeyFn).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // createdById not provided → provisioning skipped entirely
  // -------------------------------------------------------------------------

  it("skips callback provisioning entirely when createdById is not passed", async () => {
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce(freshSwarm() as never)
      .mockResolvedValueOnce(freshSwarm() as never);
    vi.mocked(dbMock.swarm.update).mockResolvedValue({} as never);

    const createApiKeyFn = makeCreateApiKeyFn();
    const client = makePluginClient();

    // Call without createdById
    const result = await ensureBifrostAgentCatalog(WORKSPACE_ID, undefined, {
      pluginClientFactory: () => client,
      createApiKeyFn,
    });

    expect(result.status).toBe("seeded");
    expect(createApiKeyFn).not.toHaveBeenCalled();
    expect(client.pushHiveCallback).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Existing catalog reconcile behaviour preserved
  // -------------------------------------------------------------------------

  it("returns 'skipped-no-swarm' when swarm has no swarmUrl", async () => {
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce(
      { swarmUrl: null, swarmApiKey: ENCRYPTED_TOKEN, bifrostAgentsSeedHash: null, gatewayHiveKeyId: null } as never,
    );

    const result = await ensureBifrostAgentCatalog(WORKSPACE_ID, USER_ID);
    expect(result.status).toBe("skipped-no-swarm");
  });

  it("returns 'skipped-no-token' when swarm has no swarmApiKey", async () => {
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce(
      { swarmUrl: SWARM_URL, swarmApiKey: null, bifrostAgentsSeedHash: null, gatewayHiveKeyId: null } as never,
    );

    const result = await ensureBifrostAgentCatalog(WORKSPACE_ID, USER_ID);
    expect(result.status).toBe("skipped-no-token");
  });

  it("returns 'skipped-no-swarm' and does not stamp hash on 503 from seedAgentCatalog", async () => {
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce(freshSwarm() as never)
      .mockResolvedValueOnce(freshSwarm() as never);

    const client = makePluginClient({
      seedAgentCatalog: vi.fn().mockRejectedValue(
        new BifrostHttpError(503, undefined, "catalog not configured"),
      ),
    });
    const createApiKeyFn = makeCreateApiKeyFn();

    const result = await ensureBifrostAgentCatalog(WORKSPACE_ID, USER_ID, {
      pluginClientFactory: () => client,
      createApiKeyFn,
    });

    expect(result.status).toBe("skipped-no-swarm");
    expect(dbMock.swarm.update).not.toHaveBeenCalled();
    // callback provisioning skipped because seed didn't complete
    expect(client.pushHiveCallback).not.toHaveBeenCalled();
  });

  it("returns 'failed' when seedAgentCatalog throws a non-503 error", async () => {
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce(freshSwarm() as never)
      .mockResolvedValueOnce(freshSwarm() as never);

    const client = makePluginClient({
      seedAgentCatalog: vi.fn().mockRejectedValue(
        new BifrostHttpError(500, undefined, "internal error"),
      ),
    });

    const result = await ensureBifrostAgentCatalog(WORKSPACE_ID, USER_ID, {
      pluginClientFactory: () => client,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
  });
});
