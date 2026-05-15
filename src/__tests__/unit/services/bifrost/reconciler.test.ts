import { describe, it, expect, vi, beforeEach } from "vitest";
import { reconcileBifrostVK } from "@/services/bifrost/reconciler";
import type { BifrostClient } from "@/services/bifrost/BifrostClient";
import { dbMock } from "@/__tests__/support/mocks/prisma";

// withLock should just run the fn synchronously in unit tests — Redis isn't
// involved.
vi.mock("@/lib/locks/redis-lock", () => ({
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  LockAcquireTimeoutError: class LockAcquireTimeoutError extends Error {},
}));

// EncryptionService — round-trip via a deterministic JSON envelope.
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
      decryptField: vi.fn(
        (_field: string, payload: { data: string }) => payload.data,
      ),
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

function makeClientStub(
  overrides: Partial<BifrostClient> = {},
): BifrostClient {
  const stub = {
    listCustomers: vi.fn(),
    createCustomer: vi.fn(),
    listVirtualKeys: vi.fn(),
    createVirtualKey: vi.fn(),
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
      baseUrl: "http://bifrost.test:8181",
      created: false,
    });
    expect(client.listCustomers).not.toHaveBeenCalled();
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
});
