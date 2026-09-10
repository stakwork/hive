import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildBifrostName,
  reconcileBifrostVK,
} from "@/services/bifrost/reconciler";
import { BifrostHttpError, type BifrostClient } from "@/services/bifrost/BifrostClient";
import { dbMock } from "@/__tests__/support/mocks/prisma";

// withLock should just run the fn synchronously in unit tests — Redis isn't
// involved.
vi.mock("@/lib/locks/redis-lock", () => ({
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  LockAcquireTimeoutError: class LockAcquireTimeoutError extends Error {},
}));

// EncryptionService — minimal round-trip: encryptField returns a
// deterministic envelope (whose JSON.stringify form is a real string);
// decryptField accepts either the raw envelope or a JSON-stringified
// envelope (matching the real implementation), and throws on garbage.
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      encryptField: vi.fn((field: string, value: string) => ({
        data: value,
        iv: "iv",
        tag: "tag",
        version: "1",
        encryptedAt: "2026-01-01T00:00:00Z",
      })),
      decryptField: vi.fn((_field: string, input: unknown) => {
        let payload: { data?: unknown } | null = null;
        if (typeof input === "string") {
          try {
            payload = JSON.parse(input);
          } catch {
            throw new Error("Invalid encrypted data");
          }
        } else if (input && typeof input === "object") {
          payload = input as { data?: unknown };
        }
        if (!payload || typeof payload.data !== "string") {
          throw new Error("Invalid encrypted data format");
        }
        return payload.data;
      }),
    })),
  },
}));

// We avoid pulling in the resolver's encryption logic by stubbing it.
vi.mock("@/services/bifrost/resolve", () => ({
  resolveBifrost: vi.fn(async () => ({
    baseUrl: "http://bifrost.test:8181",
    adminUser: "admin",
    adminPassword: "secret",
  })),
  deriveBifrostBaseUrl: vi.fn(),
  BifrostConfigError: class BifrostConfigError extends Error {},
}));

const ALL_PROVIDERS = ["anthropic", "openai", "openrouter", "gemini", "xai"];

/** `GET /api/providers` body for a gateway with exactly these configured. */
function providersResponse(names: string[]) {
  return {
    providers: names.map((name) => ({ name, provider_status: "active" })),
    total: names.length,
  };
}

/** A hydrated (response-side) provider_config as Bifrost returns it. */
function hydratedConfig(
  id: number,
  provider: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    virtual_key_id: "vk-1",
    provider,
    weight: null,
    allowed_models: ["*"],
    blacklisted_models: [],
    allow_all_keys: true,
    keys: [],
    ...extra,
  };
}

function makeClientStub(
  overrides: Partial<BifrostClient> = {},
): BifrostClient {
  const stub = {
    listCustomers: vi.fn(),
    createCustomer: vi.fn(),
    listVirtualKeys: vi.fn(),
    createVirtualKey: vi.fn(),
    getVirtualKey: vi.fn(),
    updateVirtualKey: vi.fn(),
    // Default: a gateway with every default provider configured, so
    // tests that don't care about grants see the full set.
    listProviders: vi
      .fn()
      .mockResolvedValue(providersResponse(ALL_PROVIDERS)),
    ...overrides,
  } as unknown as BifrostClient;
  return stub;
}

const WORKSPACE_ID = "ws-1";
const USER_ID = "u_alice";

describe("reconcileBifrostVK", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the cached VK without calling Bifrost", async () => {
    vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce({
      id: "mem-1",
      bifrostVkValue: JSON.stringify({
        data: "sk-bf-CACHED",
        iv: "iv",
        tag: "tag",
        version: "1",
        encryptedAt: "x",
      }),
      bifrostVkId: "vk-1",
      bifrostCustomerId: "cust-1",
      bifrostSyncedAt: new Date(),
    } as never);

    const client = makeClientStub();
    const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
      clientFactory: () => client,
    });

    expect(result).toEqual({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      customerId: "cust-1",
      vkId: "vk-1",
      vkValue: "sk-bf-CACHED",
      // No `model` option supplied -> defaults to the anthropic
      // suffix. The admin URL `BifrostClient` uses is still the
      // root from `resolveBifrost` (mocked above); this is the
      // LLM-facing URL we hand back to callers.
      baseUrl: "http://bifrost.test:8181/anthropic/v1",
      created: false,
    });
    expect(client.listCustomers).not.toHaveBeenCalled();
    expect(client.listProviders).not.toHaveBeenCalled();
    expect(client.getVirtualKey).not.toHaveBeenCalled();
    expect(dbMock.workspaceMember.update).not.toHaveBeenCalled();
  });

  it("creates customer + VK and persists the VK when nothing exists", async () => {
    vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce({
      id: "mem-1",
      bifrostVkValue: null,
      bifrostVkId: null,
      bifrostCustomerId: null,
    } as never);

    const client = makeClientStub({
      listCustomers: vi.fn().mockResolvedValue({
        customers: [],
        count: 0,
        total_count: 0,
        limit: 50,
        offset: 0,
      }),
      createCustomer: vi.fn().mockResolvedValue({
        message: "ok",
        customer: { id: "cust-1", name: USER_ID, created_at: "2026-01-01" },
      }),
      listVirtualKeys: vi.fn().mockResolvedValue({
        virtual_keys: [],
        count: 0,
        total_count: 0,
        limit: 50,
        offset: 0,
      }),
      createVirtualKey: vi.fn().mockResolvedValue({
        message: "ok",
        virtual_key: {
          id: "vk-1",
          name: USER_ID,
          value: "sk-bf-NEW",
          customer_id: "cust-1",
          created_at: "2026-01-01",
        },
      }),
    });

    const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
      clientFactory: () => client,
    });

    expect(result.vkValue).toBe("sk-bf-NEW");
    expect(result.customerId).toBe("cust-1");
    expect(result.vkId).toBe("vk-1");
    expect(result.created).toBe(true);
    expect(client.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: USER_ID,
        budget: expect.objectContaining({ max_limit: 1000 }),
      }),
    );
    expect(client.createVirtualKey).toHaveBeenCalledWith(
      expect.objectContaining({
        name: USER_ID,
        customer_id: "cust-1",
        provider_configs: expect.any(Array),
      }),
    );
    expect(dbMock.workspaceMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mem-1" },
        data: expect.objectContaining({
          bifrostVkId: "vk-1",
          bifrostCustomerId: "cust-1",
          bifrostVkValue: expect.stringContaining("sk-bf-NEW"),
        }),
      }),
    );
  });

  it("reuses an existing customer + VK (idempotent, no creates)", async () => {
    vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce({
      id: "mem-1",
      bifrostVkValue: null,
      bifrostVkId: null,
      bifrostCustomerId: null,
    } as never);

    const client = makeClientStub({
      listCustomers: vi.fn().mockResolvedValue({
        customers: [
          { id: "cust-1", name: USER_ID, created_at: "2026-01-01" },
        ],
        count: 1,
        total_count: 1,
        limit: 50,
        offset: 0,
      }),
      listVirtualKeys: vi.fn().mockResolvedValue({
        virtual_keys: [
          {
            id: "vk-1",
            name: USER_ID,
            value: "sk-bf-EXISTING",
            customer_id: "cust-1",
            created_at: "2026-01-01",
          },
        ],
        count: 1,
        total_count: 1,
        limit: 50,
        offset: 0,
      }),
    });

    const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
      clientFactory: () => client,
    });

    expect(result.vkValue).toBe("sk-bf-EXISTING");
    expect(result.created).toBe(false);
    expect(client.createCustomer).not.toHaveBeenCalled();
    expect(client.createVirtualKey).not.toHaveBeenCalled();
  });

  it("ignores substring-only customer matches and creates", async () => {
    vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce({
      id: "mem-1",
      bifrostVkValue: null,
      bifrostVkId: null,
      bifrostCustomerId: null,
    } as never);

    const client = makeClientStub({
      // Bifrost search is substring; "u_alice" matches "u_alice_other".
      // The reconciler must filter to exact-name and create a new customer.
      listCustomers: vi.fn().mockResolvedValue({
        customers: [
          { id: "cust-x", name: "u_alice_other", created_at: "2026-01-01" },
        ],
        count: 1,
        total_count: 1,
        limit: 50,
        offset: 0,
      }),
      createCustomer: vi.fn().mockResolvedValue({
        message: "ok",
        customer: { id: "cust-1", name: USER_ID, created_at: "2026-01-02" },
      }),
      listVirtualKeys: vi.fn().mockResolvedValue({
        virtual_keys: [],
        count: 0,
        total_count: 0,
        limit: 50,
        offset: 0,
      }),
      createVirtualKey: vi.fn().mockResolvedValue({
        message: "ok",
        virtual_key: {
          id: "vk-1",
          name: USER_ID,
          value: "sk-bf-NEW",
          customer_id: "cust-1",
          created_at: "2026-01-02",
        },
      }),
    });

    const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
      clientFactory: () => client,
    });
    expect(result.customerId).toBe("cust-1");
    expect(client.createCustomer).toHaveBeenCalledTimes(1);
  });

  it("picks the oldest when duplicate exact-name customers exist", async () => {
    vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce({
      id: "mem-1",
      bifrostVkValue: null,
      bifrostVkId: null,
      bifrostCustomerId: null,
    } as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = makeClientStub({
      listCustomers: vi.fn().mockResolvedValue({
        customers: [
          { id: "newer", name: USER_ID, created_at: "2026-02-01" },
          { id: "oldest", name: USER_ID, created_at: "2026-01-01" },
          { id: "middle", name: USER_ID, created_at: "2026-01-15" },
        ],
        count: 3,
        total_count: 3,
        limit: 50,
        offset: 0,
      }),
      listVirtualKeys: vi.fn().mockResolvedValue({
        virtual_keys: [
          {
            id: "vk-1",
            name: USER_ID,
            value: "sk-bf-A",
            customer_id: "oldest",
            created_at: "2026-01-01",
          },
        ],
        count: 1,
        total_count: 1,
        limit: 50,
        offset: 0,
      }),
    });

    const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
      clientFactory: () => client,
    });
    expect(result.customerId).toBe("oldest");
  });

  it("throws when the user is not a workspace member", async () => {
    vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce(
      null as never,
    );

    await expect(
      reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => makeClientStub(),
      }),
    ).rejects.toThrow(/not a member/);
  });

  it("re-reconciles when the cached VK fails to decrypt", async () => {
    vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce({
      id: "mem-1",
      bifrostVkValue: "{not valid json",
      bifrostVkId: "vk-1",
      bifrostCustomerId: "cust-1",
    } as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = makeClientStub({
      listCustomers: vi.fn().mockResolvedValue({
        customers: [
          { id: "cust-1", name: USER_ID, created_at: "2026-01-01" },
        ],
        count: 1,
        total_count: 1,
        limit: 50,
        offset: 0,
      }),
      listVirtualKeys: vi.fn().mockResolvedValue({
        virtual_keys: [
          {
            id: "vk-1",
            name: USER_ID,
            value: "sk-bf-RESTORED",
            customer_id: "cust-1",
            created_at: "2026-01-01",
          },
        ],
        count: 1,
        total_count: 1,
        limit: 50,
        offset: 0,
      }),
    });

    const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
      clientFactory: () => client,
    });
    expect(result.vkValue).toBe("sk-bf-RESTORED");
    expect(dbMock.workspaceMember.update).toHaveBeenCalled();
  });

  it("recovers when Customer create races: 400 dup-key → readback", async () => {
    vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce({
      id: "mem-1",
      bifrostVkValue: null,
      bifrostVkId: null,
      bifrostCustomerId: null,
    } as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // First listCustomers: empty (nothing exists yet)
    // createCustomer: 400 with duplicate-key body (race lost)
    // Second listCustomers (readback): the winning row is now there
    // listVirtualKeys/createVirtualKey: proceed normally
    const listCustomers = vi
      .fn()
      .mockResolvedValueOnce({
        customers: [],
        count: 0,
        total_count: 0,
        limit: 50,
        offset: 0,
      })
      .mockResolvedValueOnce({
        customers: [
          { id: "cust-winner", name: USER_ID, created_at: "2026-01-01" },
        ],
        count: 1,
        total_count: 1,
        limit: 50,
        offset: 0,
      });
    const createCustomer = vi
      .fn()
      .mockRejectedValueOnce(
        new BifrostHttpError(
          400,
          { error: "Failed to create customer: duplicate key value" },
          "Bifrost POST /api/governance/customers failed: 400 duplicate key value",
        ),
      );

    const client = makeClientStub({
      listCustomers,
      createCustomer,
      listVirtualKeys: vi.fn().mockResolvedValue({
        virtual_keys: [],
        count: 0,
        total_count: 0,
        limit: 50,
        offset: 0,
      }),
      createVirtualKey: vi.fn().mockResolvedValue({
        message: "ok",
        virtual_key: {
          id: "vk-1",
          name: USER_ID,
          value: "sk-bf-AFTER-RACE",
          customer_id: "cust-winner",
          created_at: "2026-01-01",
        },
      }),
    });

    const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
      clientFactory: () => client,
    });

    expect(result.customerId).toBe("cust-winner");
    expect(result.vkValue).toBe("sk-bf-AFTER-RACE");
    expect(listCustomers).toHaveBeenCalledTimes(2);
    expect(createCustomer).toHaveBeenCalledTimes(1);
  });

  it("recovers when VK create races: 400 dup-key → readback", async () => {
    vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce({
      id: "mem-1",
      bifrostVkValue: null,
      bifrostVkId: null,
      bifrostCustomerId: null,
    } as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Customer already exists; VK list says none → try createVirtualKey →
    // 400 dup-key → readback finds the winning row.
    const listVirtualKeys = vi
      .fn()
      .mockResolvedValueOnce({
        virtual_keys: [],
        count: 0,
        total_count: 0,
        limit: 50,
        offset: 0,
      })
      .mockResolvedValueOnce({
        virtual_keys: [
          {
            id: "vk-winner",
            name: USER_ID,
            value: "sk-bf-WINNER",
            customer_id: "cust-1",
            created_at: "2026-01-01",
          },
        ],
        count: 1,
        total_count: 1,
        limit: 50,
        offset: 0,
      });
    const createVirtualKey = vi
      .fn()
      .mockRejectedValueOnce(
        new BifrostHttpError(
          400,
          {
            error:
              "Failed to create virtual key: duplicate key value violates unique constraint",
          },
          "Bifrost POST /api/governance/virtual-keys failed: 400 duplicate key value violates unique constraint",
        ),
      );

    const client = makeClientStub({
      listCustomers: vi.fn().mockResolvedValue({
        customers: [
          { id: "cust-1", name: USER_ID, created_at: "2026-01-01" },
        ],
        count: 1,
        total_count: 1,
        limit: 50,
        offset: 0,
      }),
      listVirtualKeys,
      createVirtualKey,
    });

    const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
      clientFactory: () => client,
    });

    expect(result.vkId).toBe("vk-winner");
    expect(result.vkValue).toBe("sk-bf-WINNER");
    expect(listVirtualKeys).toHaveBeenCalledTimes(2);
    expect(createVirtualKey).toHaveBeenCalledTimes(1);
  });

  it("does NOT swallow non-duplicate Bifrost 400s on Customer create", async () => {
    vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce({
      id: "mem-1",
      bifrostVkValue: null,
      bifrostVkId: null,
      bifrostCustomerId: null,
    } as never);

    const client = makeClientStub({
      listCustomers: vi.fn().mockResolvedValue({
        customers: [],
        count: 0,
        total_count: 0,
        limit: 50,
        offset: 0,
      }),
      createCustomer: vi.fn().mockRejectedValue(
        new BifrostHttpError(
          400,
          { error: "Customer name is required" },
          "Bifrost POST /api/governance/customers failed: 400 Customer name is required",
        ),
      ),
    });

    await expect(
      reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      }),
    ).rejects.toMatchObject({ name: "BifrostHttpError", status: 400 });
  });

  describe("model -> baseUrl suffixing", () => {
    /**
     * Helper: stub the cache-hit fast-path and run the reconciler
     * with a given `model`, returning just the `baseUrl` field.
     * Lets us spot-check the suffix mapping cheaply without
     * exercising the full Customer/VK creation flow.
     */
    async function reconcileWithModel(
      model: string | undefined,
    ): Promise<string> {
      vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce({
        id: "mem-1",
        bifrostVkValue: JSON.stringify({
          data: "sk-bf-CACHED",
          iv: "iv",
          tag: "tag",
          version: "1",
          encryptedAt: "x",
        }),
        bifrostVkId: "vk-1",
        bifrostCustomerId: "cust-1",
        bifrostSyncedAt: new Date(),
      } as never);

      const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => makeClientStub(),
        model,
      });
      return result.baseUrl;
    }

    it.each([
      ["sonnet", "http://bifrost.test:8181/anthropic/v1"],
      ["opus", "http://bifrost.test:8181/anthropic/v1"],
      ["haiku", "http://bifrost.test:8181/anthropic/v1"],
      [
        "anthropic/claude-sonnet-4-6",
        "http://bifrost.test:8181/anthropic/v1",
      ],
      ["gpt-5", "http://bifrost.test:8181/openai/v1"],
      ["gpt", "http://bifrost.test:8181/openai/v1"],
      ["gemini", "http://bifrost.test:8181/genai/v1beta"],
      [
        "google/gemini-3-pro-preview",
        "http://bifrost.test:8181/genai/v1beta",
      ],
      // OpenRouter rides Bifrost's OpenAI route.
      ["kimi", "http://bifrost.test:8181/openai/v1"],
      // So does xAI — Bifrost has no dedicated Grok route.
      ["xai/grok-4.3", "http://bifrost.test:8181/openai/v1"],
      // Default (no model) -> anthropic.
      [undefined, "http://bifrost.test:8181/anthropic/v1"],
    ])("model=%s -> baseUrl=%s", async (model, expected) => {
      await expect(reconcileWithModel(model)).resolves.toBe(expected);
    });
  });

  describe("buildBifrostName", () => {
    it("prefixes the userId with the GitHub login when available", () => {
      expect(buildBifrostName("u_alice", "Evanfeenstra")).toBe(
        "Evanfeenstra-u_alice",
      );
    });

    it("falls back to the bare userId when no GitHub login exists", () => {
      expect(buildBifrostName("u_alice", null)).toBe("u_alice");
    });

    it("treats a blank/whitespace login as missing", () => {
      expect(buildBifrostName("u_alice", "   ")).toBe("u_alice");
    });
  });

  describe("uses the {login}-{userId} naming when GitHubAuth exists", () => {
    it("passes the prefixed name to Bifrost create + lookup", async () => {
      vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce({
        id: "mem-1",
        bifrostVkValue: null,
        bifrostVkId: null,
        bifrostCustomerId: null,
        user: { githubAuth: { githubUsername: "Evanfeenstra" } },
      } as never);

      const expectedName = `Evanfeenstra-${USER_ID}`;

      const client = makeClientStub({
        listCustomers: vi.fn().mockResolvedValue({
          customers: [],
          count: 0,
          total_count: 0,
          limit: 50,
          offset: 0,
        }),
        createCustomer: vi.fn().mockResolvedValue({
          message: "ok",
          customer: {
            id: "cust-1",
            name: expectedName,
            created_at: "2026-01-01",
          },
        }),
        listVirtualKeys: vi.fn().mockResolvedValue({
          virtual_keys: [],
          count: 0,
          total_count: 0,
          limit: 50,
          offset: 0,
        }),
        createVirtualKey: vi.fn().mockResolvedValue({
          message: "ok",
          virtual_key: {
            id: "vk-1",
            name: expectedName,
            value: "sk-bf-NEW",
            customer_id: "cust-1",
            created_at: "2026-01-01",
          },
        }),
      });

      await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      // Lookups go through `search` (substring) — assert the
      // human-readable name flows all the way through.
      expect(client.listCustomers).toHaveBeenCalledWith(
        expect.objectContaining({ search: expectedName }),
      );
      expect(client.createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({ name: expectedName }),
      );
      expect(client.listVirtualKeys).toHaveBeenCalledWith(
        expect.objectContaining({ search: expectedName }),
      );
      expect(client.createVirtualKey).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expectedName,
          description: expect.stringContaining(expectedName),
        }),
      );
    });
  });
});

describe("provider grants", () => {
  const FOUR = ["anthropic", "openai", "openrouter", "gemini"];
  const DAY_MS = 24 * 60 * 60 * 1000;

  const customers = {
    customers: [{ id: "cust-1", name: USER_ID, created_at: "2026-01-01" }],
    count: 1,
    total_count: 1,
    limit: 50,
    offset: 0,
  };
  function vkList(vks: unknown[]) {
    return {
      virtual_keys: vks,
      count: vks.length,
      total_count: vks.length,
      limit: 50,
      offset: 0,
    };
  }
  /** An existing VK; `configs === undefined` omits provider_configs entirely. */
  function existingVk(configs: unknown[] | undefined) {
    return {
      id: "vk-1",
      name: USER_ID,
      value: "sk-bf-EXISTING",
      customer_id: "cust-1",
      created_at: "2026-01-01",
      ...(configs === undefined ? {} : { provider_configs: configs }),
    };
  }
  function fourConfigs() {
    return FOUR.map((provider, i) => hydratedConfig(i + 1, provider));
  }
  const createdVk = {
    message: "ok",
    virtual_key: {
      id: "vk-1",
      name: USER_ID,
      value: "sk-bf-NEW",
      customer_id: "cust-1",
      created_at: "2026-01-02",
    },
  };
  function uncachedMember() {
    vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce({
      id: "mem-1",
      bifrostVkValue: null,
      bifrostVkId: null,
      bifrostCustomerId: null,
    } as never);
  }
  function cachedMember(bifrostSyncedAt: Date | null) {
    vi.mocked(dbMock.workspaceMember.findUnique).mockResolvedValueOnce({
      id: "mem-1",
      bifrostVkValue: JSON.stringify({
        data: "sk-bf-CACHED",
        iv: "iv",
        tag: "tag",
        version: "1",
        encryptedAt: "x",
      }),
      bifrostVkId: "vk-1",
      bifrostCustomerId: "cust-1",
      bifrostSyncedAt,
    } as never);
  }
  /** Client for the create path: customer exists, no VK yet. */
  function creatingClient(overrides: Partial<BifrostClient> = {}) {
    return makeClientStub({
      listCustomers: vi.fn().mockResolvedValue(customers),
      listVirtualKeys: vi.fn().mockResolvedValue(vkList([])),
      createVirtualKey: vi.fn().mockResolvedValue(createdVk),
      ...overrides,
    });
  }
  function grantedProviders(client: BifrostClient): string[] {
    const input = vi.mocked(client.createVirtualKey).mock.calls[0][0];
    return input.provider_configs.map((pc) => pc.provider);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  describe("on create", () => {
    it("grants only the default providers the gateway has configured", async () => {
      uncachedMember();
      const client = creatingClient({
        listProviders: vi.fn().mockResolvedValue(providersResponse(FOUR)),
      });

      await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      expect(grantedProviders(client)).toEqual(FOUR);
      const input = vi.mocked(client.createVirtualKey).mock.calls[0][0];
      for (const pc of input.provider_configs) {
        expect(pc).toEqual({
          provider: pc.provider,
          allowed_models: ["*"],
          key_ids: ["*"],
        });
      }
    });

    it("grants every default provider, xai included, when the gateway has them all", async () => {
      uncachedMember();
      const client = creatingClient();

      await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      expect(grantedProviders(client)).toEqual(ALL_PROVIDERS);
    });

    it("ignores configured providers Hive doesn't list", async () => {
      uncachedMember();
      const client = creatingClient({
        listProviders: vi
          .fn()
          .mockResolvedValue(providersResponse([...ALL_PROVIDERS, "vertex"])),
      });

      await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      expect(grantedProviders(client)).toEqual(ALL_PROVIDERS);
    });

    it("falls back to every default provider when the providers list fails", async () => {
      uncachedMember();
      const client = creatingClient({
        listProviders: vi
          .fn()
          .mockRejectedValue(new BifrostHttpError(500, undefined, "boom")),
      });

      await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      expect(grantedProviders(client)).toEqual(ALL_PROVIDERS);
    });

    it("falls back to every default provider when the gateway lists none of them", async () => {
      uncachedMember();
      const client = creatingClient({
        listProviders: vi.fn().mockResolvedValue(providersResponse(["vertex"])),
      });

      await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      expect(grantedProviders(client)).toEqual(ALL_PROVIDERS);
    });
  });

  describe("on an existing VK", () => {
    it("tops up a VK missing a provider the gateway now has", async () => {
      uncachedMember();
      const updateVirtualKey = vi.fn().mockResolvedValue({
        message: "ok",
        virtual_key: existingVk([...fourConfigs(), hydratedConfig(5, "xai")]),
      });
      const client = makeClientStub({
        listCustomers: vi.fn().mockResolvedValue(customers),
        listVirtualKeys: vi
          .fn()
          .mockResolvedValue(vkList([existingVk(fourConfigs())])),
        updateVirtualKey,
      });

      const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      expect(result.vkValue).toBe("sk-bf-EXISTING");
      expect(result.created).toBe(false);
      expect(client.createVirtualKey).not.toHaveBeenCalled();
      expect(updateVirtualKey).toHaveBeenCalledTimes(1);
      const [vkId, input] = updateVirtualKey.mock.calls[0];
      expect(vkId).toBe("vk-1");
      // Every existing config rides along with its id and key grant
      // intact (a PUT that omitted one would delete it)…
      expect(input.provider_configs.slice(0, 4)).toEqual(
        FOUR.map((provider, i) => ({
          id: i + 1,
          provider,
          allowed_models: ["*"],
          blacklisted_models: [],
          key_ids: ["*"],
        })),
      );
      // …and the missing one is appended as a fresh, id-less grant.
      expect(input.provider_configs[4]).toEqual({
        provider: "xai",
        allowed_models: ["*"],
        key_ids: ["*"],
      });
    });

    it("leaves a VK alone when it already carries every desired provider", async () => {
      uncachedMember();
      const client = makeClientStub({
        listCustomers: vi.fn().mockResolvedValue(customers),
        listVirtualKeys: vi.fn().mockResolvedValue(
          vkList([existingVk([...fourConfigs(), hydratedConfig(5, "xai")])]),
        ),
      });

      await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      expect(client.updateVirtualKey).not.toHaveBeenCalled();
    });

    it("does not top up a provider the gateway lacks too", async () => {
      uncachedMember();
      const client = makeClientStub({
        listProviders: vi.fn().mockResolvedValue(providersResponse(FOUR)),
        listCustomers: vi.fn().mockResolvedValue(customers),
        listVirtualKeys: vi
          .fn()
          .mockResolvedValue(vkList([existingVk(fourConfigs())])),
      });

      await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      expect(client.updateVirtualKey).not.toHaveBeenCalled();
    });

    it("skips the top-up when Bifrost didn't hydrate provider_configs", async () => {
      uncachedMember();
      const client = makeClientStub({
        listCustomers: vi.fn().mockResolvedValue(customers),
        listVirtualKeys: vi
          .fn()
          .mockResolvedValue(vkList([existingVk(undefined)])),
      });

      const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      expect(result.vkValue).toBe("sk-bf-EXISTING");
      expect(client.updateVirtualKey).not.toHaveBeenCalled();
    });

    it("carries a key-scoped grant through the top-up untouched", async () => {
      uncachedMember();
      const scoped = hydratedConfig(2, "openai", {
        allow_all_keys: false,
        keys: [{ key_id: "k-1" }, { key_id: "k-2" }],
      });
      const client = makeClientStub({
        listCustomers: vi.fn().mockResolvedValue(customers),
        listVirtualKeys: vi.fn().mockResolvedValue(
          vkList([existingVk([hydratedConfig(1, "anthropic"), scoped])]),
        ),
      });

      await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      const [, input] = vi.mocked(client.updateVirtualKey).mock.calls[0];
      expect(input.provider_configs[1]).toEqual({
        id: 2,
        provider: "openai",
        allowed_models: ["*"],
        blacklisted_models: [],
        key_ids: ["k-1", "k-2"],
      });
    });

    it("keeps the VK when the top-up fails", async () => {
      uncachedMember();
      const client = makeClientStub({
        listCustomers: vi.fn().mockResolvedValue(customers),
        listVirtualKeys: vi
          .fn()
          .mockResolvedValue(vkList([existingVk(fourConfigs())])),
        updateVirtualKey: vi
          .fn()
          .mockRejectedValue(
            new BifrostHttpError(400, undefined, "invalid provider name: xai"),
          ),
      });

      const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      expect(result.vkValue).toBe("sk-bf-EXISTING");
      expect(result.created).toBe(false);
      expect(dbMock.workspaceMember.update).toHaveBeenCalled();
    });
  });

  describe("on the cached path", () => {
    it("serves the cache without touching Bifrost while the grants are fresh", async () => {
      cachedMember(new Date());
      const client = makeClientStub();

      const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      expect(result.vkValue).toBe("sk-bf-CACHED");
      expect(client.listProviders).not.toHaveBeenCalled();
      expect(client.getVirtualKey).not.toHaveBeenCalled();
      expect(client.updateVirtualKey).not.toHaveBeenCalled();
      expect(dbMock.workspaceMember.update).not.toHaveBeenCalled();
    });

    it("re-checks the grants once the cache is older than the refresh window", async () => {
      cachedMember(new Date(Date.now() - DAY_MS - 60_000));
      const updateVirtualKey = vi.fn().mockResolvedValue({
        message: "ok",
        virtual_key: existingVk([]),
      });
      const client = makeClientStub({
        getVirtualKey: vi
          .fn()
          .mockResolvedValue({ virtual_key: existingVk(fourConfigs()) }),
        updateVirtualKey,
      });

      const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      // Still the cached VK — the refresh is a side effect, not a re-provision.
      expect(result.vkValue).toBe("sk-bf-CACHED");
      expect(result.created).toBe(false);
      expect(client.listCustomers).not.toHaveBeenCalled();
      expect(client.createVirtualKey).not.toHaveBeenCalled();
      expect(client.getVirtualKey).toHaveBeenCalledWith("vk-1");
      expect(updateVirtualKey).toHaveBeenCalledTimes(1);
      expect(
        updateVirtualKey.mock.calls[0][1].provider_configs.map(
          (pc: { provider: string }) => pc.provider,
        ),
      ).toEqual(ALL_PROVIDERS);
      expect(dbMock.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: "mem-1" },
        data: { bifrostSyncedAt: expect.any(Date) },
      });
    });

    it("treats a missing bifrostSyncedAt as stale", async () => {
      cachedMember(null);
      const client = makeClientStub({
        getVirtualKey: vi.fn().mockResolvedValue({
          virtual_key: existingVk([...fourConfigs(), hydratedConfig(5, "xai")]),
        }),
      });

      await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      expect(client.getVirtualKey).toHaveBeenCalledWith("vk-1");
      expect(client.updateVirtualKey).not.toHaveBeenCalled();
      expect(dbMock.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: "mem-1" },
        data: { bifrostSyncedAt: expect.any(Date) },
      });
    });

    it("serves the cache and still stamps the row when the refresh fails", async () => {
      cachedMember(null);
      const client = makeClientStub({
        getVirtualKey: vi
          .fn()
          .mockRejectedValue(
            new BifrostHttpError(404, undefined, "Virtual key not found"),
          ),
      });

      const result = await reconcileBifrostVK(WORKSPACE_ID, USER_ID, {
        clientFactory: () => client,
      });

      expect(result.vkValue).toBe("sk-bf-CACHED");
      expect(client.updateVirtualKey).not.toHaveBeenCalled();
      expect(dbMock.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: "mem-1" },
        data: { bifrostSyncedAt: expect.any(Date) },
      });
    });
  });
});
