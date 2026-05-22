import { describe, it, expect, vi, beforeEach } from "vitest";

import { ensureBifrostTrust } from "@/services/bifrost/trust-reconciler";
import { BifrostHttpError } from "@/services/bifrost/BifrostClient";
import type { BifrostPluginClient } from "@/services/bifrost/BifrostPluginClient";
import { dbMock } from "@/__tests__/support/mocks/prisma";

vi.mock("@/lib/locks/redis-lock", () => ({
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  LockAcquireTimeoutError: class LockAcquireTimeoutError extends Error {},
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      encryptField: vi.fn((_field: string, value: string) => ({
        data: value,
        iv: "iv",
        tag: "tag",
        version: "1",
        encryptedAt: "2026-01-01T00:00:00Z",
      })),
      decryptField: vi.fn((_field: string, input: unknown) => {
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

// deriveBifrostBaseUrl is pure; stub to a deterministic value so test
// expectations don't depend on URL canonicalisation rules.
vi.mock("@/services/bifrost/resolve", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/bifrost/resolve")
  >("@/services/bifrost/resolve");
  return {
    ...actual,
    deriveBifrostBaseUrl: vi.fn(() => "http://bifrost.test:8181"),
  };
});

const WORKSPACE_ID = "ws-1";
const WORKSPACE_SLUG = "acme-ws";
const SCORG_ID = "scorg-1";
const ORG_PUBKEY = "02" + "ab".repeat(32);
const ENCRYPTED_TOKEN = JSON.stringify({ data: "provisioning-secret-plain" });

type PluginClientStub = {
  getTrustStatus: ReturnType<typeof vi.fn>;
  getTrustOrg: ReturnType<typeof vi.fn>;
  upsertTrust: ReturnType<typeof vi.fn>;
  setRealmId: ReturnType<typeof vi.fn>;
};

function makePluginClient(
  overrides: Partial<PluginClientStub> = {},
): BifrostPluginClient {
  return {
    getTrustStatus: vi.fn(),
    getTrustOrg: vi.fn(),
    upsertTrust: vi.fn(),
    // Phase-11 realm_id sync. Default to a successful no-op return so
    // tests that don't care about realm_id don't need to wire one
    // up. Tests that DO care override to assert calls / arguments.
    setRealmId: vi.fn().mockResolvedValue({ ok: true, realm_id: "" }),
    ...overrides,
  } as unknown as BifrostPluginClient;
}

/**
 * The default `ensureKeysFn` stub returns deterministic keys without
 * touching DB / crypto. Each test that needs a different value
 * overrides via the option.
 */
function defaultEnsureKeys() {
  return vi.fn().mockResolvedValue({
    sourceControlOrgId: SCORG_ID,
    macaroonOrgId: "gh_stakwork",
    macaroonOrgPubkey: ORG_PUBKEY,
    created: false,
  });
}

describe("ensureBifrostTrust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'skipped-no-org' when the workspace has no sourceControlOrg", async () => {
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      sourceControlOrgId: null,
    } as never);

    const client = makePluginClient();
    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("skipped-no-org");
    expect(dbMock.swarm.findUnique).not.toHaveBeenCalled();
    expect(client.getTrustStatus).not.toHaveBeenCalled();
  });

  it("returns 'skipped-no-org' when the workspace itself doesn't exist", async () => {
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce(
      null as never,
    );

    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => makePluginClient(),
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("skipped-no-org");
  });

  it("returns 'skipped-no-swarm' when there is no swarm or no swarmUrl", async () => {
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce(null as never);

    const client = makePluginClient();
    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("skipped-no-swarm");
    expect(result.macaroonOrgId).toBe("gh_stakwork");
    expect(client.getTrustStatus).not.toHaveBeenCalled();
  });

  it("returns 'skipped-no-token' when the swarm has no swarmApiKey", async () => {
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce({
      id: "swarm-1",
      swarmUrl: "http://swarm.test",
      swarmApiKey: null,
      bifrostTrustedOrgId: null,
      bifrostTrustedPubkey: null,
      bifrostTrustSyncedAt: null,
    } as never);

    const client = makePluginClient();
    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("skipped-no-token");
    expect(client.getTrustStatus).not.toHaveBeenCalled();
  });

  it("returns 'cached' when the swarm row already matches the org's (orgId, pubkey)", async () => {
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce({
      id: "swarm-1",
      swarmUrl: "http://swarm.test",
      swarmApiKey: ENCRYPTED_TOKEN,
      bifrostTrustedOrgId: "gh_stakwork",
      bifrostTrustedPubkey: ORG_PUBKEY,
      bifrostTrustSyncedAt: new Date("2026-01-01"),
    } as never);

    const client = makePluginClient();
    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("cached");
    expect(client.getTrustStatus).not.toHaveBeenCalled();
    expect(client.upsertTrust).not.toHaveBeenCalled();
    expect(dbMock.swarm.update).not.toHaveBeenCalled();
  });

  it("normalises pubkey case + 0x prefix when comparing the cache", async () => {
    // Swarm row stores lowercase no-prefix; org returns uppercase
    // with 0x — they should still compare equal.
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce({
      id: "swarm-1",
      swarmUrl: "http://swarm.test",
      swarmApiKey: ENCRYPTED_TOKEN,
      bifrostTrustedOrgId: "gh_stakwork",
      bifrostTrustedPubkey: ORG_PUBKEY, // lowercase, no prefix
      bifrostTrustSyncedAt: new Date(),
    } as never);

    const keys = vi.fn().mockResolvedValue({
      sourceControlOrgId: SCORG_ID,
      macaroonOrgId: "gh_stakwork",
      macaroonOrgPubkey: "0x" + ORG_PUBKEY.toUpperCase(),
      created: false,
    });

    const client = makePluginClient();
    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: keys,
    });

    expect(result.status).toBe("cached");
    expect(client.getTrustStatus).not.toHaveBeenCalled();
  });

  it("upserts when the plugin's status doesn't include our org", async () => {
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique)
      // outer read
      .mockResolvedValueOnce({
        id: "swarm-1",
        swarmUrl: "http://swarm.test",
        swarmApiKey: ENCRYPTED_TOKEN,
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
        bifrostTrustSyncedAt: null,
      } as never)
      // re-check inside the lock
      .mockResolvedValueOnce({
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
      } as never);
    vi.mocked(dbMock.swarm.update).mockResolvedValueOnce({} as never);

    const client = makePluginClient({
      getTrustStatus: vi.fn().mockResolvedValue({
        claimed: false,
        org_count: 0,
        orgs: [],
        seed_source: "",
        last_modified: "",
      }),
      upsertTrust: vi.fn().mockResolvedValue({
        ok: true,
        org_id: "gh_stakwork",
      }),
    });

    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
      issuerUrlOverride: "https://hive.test",
    });

    expect(result.status).toBe("upserted");
    expect(client.upsertTrust).toHaveBeenCalledWith({
      org_id: "gh_stakwork",
      pubkey: ORG_PUBKEY,
      issuer_url: "https://hive.test",
      revocation_poll_seconds: expect.any(Number),
    });
    expect(client.getTrustOrg).not.toHaveBeenCalled();
    expect(dbMock.swarm.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID },
        data: expect.objectContaining({
          bifrostTrustedOrgId: "gh_stakwork",
          bifrostTrustedPubkey: ORG_PUBKEY,
          bifrostTrustSyncedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("returns 'already-registered' (no POST) when the plugin has our pubkey but cache is stale", async () => {
    // E.g. another Hive process synced this swarm a minute ago and
    // our local cache hadn't been refreshed yet. The GET-status path
    // sees the org_id present, the precise GET confirms pubkey
    // match, we just stamp the cache and return.
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce({
        id: "swarm-1",
        swarmUrl: "http://swarm.test",
        swarmApiKey: ENCRYPTED_TOKEN,
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
        bifrostTrustSyncedAt: null,
      } as never)
      .mockResolvedValueOnce({
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
      } as never);
    vi.mocked(dbMock.swarm.update).mockResolvedValueOnce({} as never);

    const client = makePluginClient({
      getTrustStatus: vi.fn().mockResolvedValue({
        claimed: true,
        org_count: 1,
        orgs: ["gh_stakwork"],
        seed_source: "api",
        last_modified: "2026-01-01T00:00:00Z",
      }),
      getTrustOrg: vi.fn().mockResolvedValue({
        org_id: "gh_stakwork",
        pubkey: ORG_PUBKEY,
        issuer_url: "https://hive.test",
        revocation_poll_seconds: 60,
      }),
    });

    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("already-registered");
    expect(client.upsertTrust).not.toHaveBeenCalled();
    expect(dbMock.swarm.update).toHaveBeenCalled();
  });

  it("upserts (overwrites) when the plugin has our org but with a different pubkey", async () => {
    // Pubkey drift on the plugin side — we POST with the correct
    // pubkey and the plugin overwrites. (Phase-1: no rotation yet,
    // but the registry endpoint accepts pubkey replacement.)
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce({
        id: "swarm-1",
        swarmUrl: "http://swarm.test",
        swarmApiKey: ENCRYPTED_TOKEN,
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
        bifrostTrustSyncedAt: null,
      } as never)
      .mockResolvedValueOnce({
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
      } as never);
    vi.mocked(dbMock.swarm.update).mockResolvedValueOnce({} as never);

    const stalePubkey = "02" + "ff".repeat(32);
    const client = makePluginClient({
      getTrustStatus: vi.fn().mockResolvedValue({
        claimed: true,
        org_count: 1,
        orgs: ["gh_stakwork"],
        seed_source: "api",
        last_modified: "",
      }),
      getTrustOrg: vi.fn().mockResolvedValue({
        org_id: "gh_stakwork",
        pubkey: stalePubkey,
        issuer_url: "",
        revocation_poll_seconds: 60,
      }),
      upsertTrust: vi.fn().mockResolvedValue({
        ok: true,
        org_id: "gh_stakwork",
      }),
    });

    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("upserted");
    expect(client.upsertTrust).toHaveBeenCalledWith(
      expect.objectContaining({ pubkey: ORG_PUBKEY }),
    );
  });

  it("re-syncs when the workspace's cached pubkey differs from the org's current pubkey", async () => {
    // E.g. the swarm's plugin data volume was wiped and another
    // bootstrap minted a different pubkey, or (eventually) the org
    // rotated. Cache mismatch -> we re-sync.
    const stale = "02" + "11".repeat(32);
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce({
        id: "swarm-1",
        swarmUrl: "http://swarm.test",
        swarmApiKey: ENCRYPTED_TOKEN,
        bifrostTrustedOrgId: "gh_stakwork",
        bifrostTrustedPubkey: stale,
        bifrostTrustSyncedAt: new Date("2026-01-01"),
      } as never)
      .mockResolvedValueOnce({
        bifrostTrustedOrgId: "gh_stakwork",
        bifrostTrustedPubkey: stale,
      } as never);
    vi.mocked(dbMock.swarm.update).mockResolvedValueOnce({} as never);

    const client = makePluginClient({
      getTrustStatus: vi.fn().mockResolvedValue({
        claimed: false,
        org_count: 0,
        orgs: [],
        seed_source: "",
        last_modified: "",
      }),
      upsertTrust: vi.fn().mockResolvedValue({
        ok: true,
        org_id: "gh_stakwork",
      }),
    });

    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("upserted");
    expect(client.upsertTrust).toHaveBeenCalled();
  });

  it("returns 'cached' (no HTTP) when a concurrent caller synced while we waited for the lock", async () => {
    // Outer read: cache miss. Inner re-check inside the lock: cache
    // hit (filled by a racer). We should NOT call the plugin.
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce({
        id: "swarm-1",
        swarmUrl: "http://swarm.test",
        swarmApiKey: ENCRYPTED_TOKEN,
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
        bifrostTrustSyncedAt: null,
      } as never)
      .mockResolvedValueOnce({
        bifrostTrustedOrgId: "gh_stakwork",
        bifrostTrustedPubkey: ORG_PUBKEY,
      } as never);

    const client = makePluginClient();
    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("cached");
    expect(client.getTrustStatus).not.toHaveBeenCalled();
    expect(dbMock.swarm.update).not.toHaveBeenCalled();
  });

  it("returns 'failed' (and does not stamp cache) when the plugin 401s on status", async () => {
    // Wrong provisioning token / plugin auth misconfigured. Logged
    // and swallowed; caller proceeds to VK reconcile.
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce({
        id: "swarm-1",
        swarmUrl: "http://swarm.test",
        swarmApiKey: ENCRYPTED_TOKEN,
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
        bifrostTrustSyncedAt: null,
      } as never)
      .mockResolvedValueOnce({
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
      } as never);

    const client = makePluginClient({
      getTrustStatus: vi
        .fn()
        .mockRejectedValue(new BifrostHttpError(401, undefined, "unauthorized")),
    });

    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(client.upsertTrust).not.toHaveBeenCalled();
    expect(dbMock.swarm.update).not.toHaveBeenCalled();
  });

  it("returns 'failed' when the upsert itself 5xxs", async () => {
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce({
        id: "swarm-1",
        swarmUrl: "http://swarm.test",
        swarmApiKey: ENCRYPTED_TOKEN,
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
        bifrostTrustSyncedAt: null,
      } as never)
      .mockResolvedValueOnce({
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
      } as never);

    const client = makePluginClient({
      getTrustStatus: vi.fn().mockResolvedValue({
        claimed: false,
        org_count: 0,
        orgs: [],
        seed_source: "",
        last_modified: "",
      }),
      upsertTrust: vi
        .fn()
        .mockRejectedValue(new BifrostHttpError(500, undefined, "boom")),
    });

    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("failed");
    expect(dbMock.swarm.update).not.toHaveBeenCalled();
  });

  it("returns 'failed' (cleanly) when ensureKeysFn throws", async () => {
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      sourceControlOrgId: SCORG_ID,
    } as never);

    const keys = vi.fn().mockRejectedValue(new Error("DB exploded"));

    const client = makePluginClient();
    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: keys,
    });

    expect(result.status).toBe("failed");
    expect(dbMock.swarm.findUnique).not.toHaveBeenCalled();
    expect(client.getTrustStatus).not.toHaveBeenCalled();
  });

  // ─── phase 11: realm_id sync ──────────────────────────────────────
  //
  // The reconciler publishes `Workspace.slug` as the swarm's
  // `realm_id` whenever it walks the cache-miss path (i.e. it already
  // has the plugin's status response in hand). On the cache-hit hot
  // path it skips the round-trip entirely. We test both branches plus
  // the "already in sync" no-op and a write-on-divergence case.

  it("publishes the workspace slug as realm_id when the plugin has none", async () => {
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      slug: WORKSPACE_SLUG,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce({
        id: "swarm-1",
        swarmUrl: "http://swarm.test",
        swarmApiKey: ENCRYPTED_TOKEN,
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
        bifrostTrustSyncedAt: null,
      } as never)
      .mockResolvedValueOnce({
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
      } as never);
    vi.mocked(dbMock.swarm.update).mockResolvedValueOnce({} as never);

    const client = makePluginClient({
      getTrustStatus: vi.fn().mockResolvedValue({
        claimed: false,
        org_count: 0,
        orgs: [],
        seed_source: "",
        last_modified: "",
        // `realm_id` absent → simple-deployment mode on the plugin
        // side. Hive should publish the workspace slug.
      }),
      upsertTrust: vi
        .fn()
        .mockResolvedValue({ ok: true, org_id: "gh_stakwork" }),
    });

    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("upserted");
    expect(client.setRealmId).toHaveBeenCalledTimes(1);
    expect(client.setRealmId).toHaveBeenCalledWith(WORKSPACE_SLUG);
  });

  it("does not call setRealmId when the plugin's realm_id already matches", async () => {
    // Idempotency: a warm reconcile that happens to also trip the
    // cache miss (e.g. pubkey rotation) shouldn't churn the plugin's
    // realm_id when it's already correct.
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      slug: WORKSPACE_SLUG,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce({
        id: "swarm-1",
        swarmUrl: "http://swarm.test",
        swarmApiKey: ENCRYPTED_TOKEN,
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
        bifrostTrustSyncedAt: null,
      } as never)
      .mockResolvedValueOnce({
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
      } as never);
    vi.mocked(dbMock.swarm.update).mockResolvedValueOnce({} as never);

    const client = makePluginClient({
      getTrustStatus: vi.fn().mockResolvedValue({
        claimed: false,
        org_count: 0,
        orgs: [],
        seed_source: "",
        last_modified: "",
        realm_id: WORKSPACE_SLUG, // already in sync
      }),
      upsertTrust: vi
        .fn()
        .mockResolvedValue({ ok: true, org_id: "gh_stakwork" }),
    });

    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("upserted");
    expect(client.setRealmId).not.toHaveBeenCalled();
  });

  it("PUTs setRealmId when the plugin's realm_id diverges from the workspace slug", async () => {
    // E.g. the workspace was renamed (rare) or the plugin was
    // bootstrapped with a stale value via the env seed.
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      slug: WORKSPACE_SLUG,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce({
        id: "swarm-1",
        swarmUrl: "http://swarm.test",
        swarmApiKey: ENCRYPTED_TOKEN,
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
        bifrostTrustSyncedAt: null,
      } as never)
      .mockResolvedValueOnce({
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
      } as never);
    vi.mocked(dbMock.swarm.update).mockResolvedValueOnce({} as never);

    const client = makePluginClient({
      getTrustStatus: vi.fn().mockResolvedValue({
        claimed: false,
        org_count: 0,
        orgs: [],
        seed_source: "",
        last_modified: "",
        realm_id: "stale-old-slug",
      }),
      upsertTrust: vi
        .fn()
        .mockResolvedValue({ ok: true, org_id: "gh_stakwork" }),
    });

    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("upserted");
    expect(client.setRealmId).toHaveBeenCalledTimes(1);
    expect(client.setRealmId).toHaveBeenCalledWith(WORKSPACE_SLUG);
  });

  it("does not touch the plugin's realm_id on the cache-hit hot path", async () => {
    // Steady state: (orgId, pubkey) cache matches, we never even
    // call getTrustStatus, so realm_id can't possibly drift via
    // this reconcile. A drifted realm_id requires bursting the
    // org/pubkey cache to reconcile — see the module doc.
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      slug: WORKSPACE_SLUG,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce({
      id: "swarm-1",
      swarmUrl: "http://swarm.test",
      swarmApiKey: ENCRYPTED_TOKEN,
      bifrostTrustedOrgId: "gh_stakwork",
      bifrostTrustedPubkey: ORG_PUBKEY,
      bifrostTrustSyncedAt: new Date("2026-01-01"),
    } as never);

    const client = makePluginClient();
    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("cached");
    expect(client.getTrustStatus).not.toHaveBeenCalled();
    expect(client.setRealmId).not.toHaveBeenCalled();
  });

  it("returns 'failed' when setRealmId rejects (does not stamp cache)", async () => {
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      slug: WORKSPACE_SLUG,
      sourceControlOrgId: SCORG_ID,
    } as never);
    vi.mocked(dbMock.swarm.findUnique)
      .mockResolvedValueOnce({
        id: "swarm-1",
        swarmUrl: "http://swarm.test",
        swarmApiKey: ENCRYPTED_TOKEN,
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
        bifrostTrustSyncedAt: null,
      } as never)
      .mockResolvedValueOnce({
        bifrostTrustedOrgId: null,
        bifrostTrustedPubkey: null,
      } as never);

    const client = makePluginClient({
      getTrustStatus: vi.fn().mockResolvedValue({
        claimed: false,
        org_count: 0,
        orgs: [],
        seed_source: "",
        last_modified: "",
      }),
      setRealmId: vi
        .fn()
        .mockRejectedValue(new BifrostHttpError(500, undefined, "boom")),
    });

    const result = await ensureBifrostTrust(WORKSPACE_ID, {
      pluginClientFactory: () => client,
      ensureKeysFn: defaultEnsureKeys(),
    });

    expect(result.status).toBe("failed");
    expect(client.upsertTrust).not.toHaveBeenCalled();
    expect(dbMock.swarm.update).not.toHaveBeenCalled();
  });
});
