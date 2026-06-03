import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { reconcileBifrostVK } from "@/services/bifrost/reconciler";
import type { BifrostClient } from "@/services/bifrost/BifrostClient";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace, createTestMembership } from "@/__tests__/support/factories/workspace.factory";
import { createTestSwarm } from "@/__tests__/support/factories/swarm.factory";

/**
 * Integration test for the Bifrost VK reconciler:
 * uses a real DB (round-trip encryption on `WorkspaceMember`), and a
 * stub `BifrostClient` injected via `clientFactory` so we never make
 * an outbound HTTP call.
 *
 * Verifies that the reconciler:
 *  - persists the VK encrypted on the right `WorkspaceMember` row
 *  - actually decrypts back to the value Bifrost returned
 *  - is idempotent: a second call hits the cache, no HTTP
 */

// Treat `withLock` as a pass-through in this test — Redis isn't part
// of the contract under test, and the integration setup doesn't boot
// a Redis instance.
vi.mock("@/lib/locks/redis-lock", () => ({
  withLock: vi.fn(
    async (_key: string, fn: () => Promise<unknown>) => fn(),
  ),
  LockAcquireTimeoutError: class LockAcquireTimeoutError extends Error {},
}));

function makeClientStub(): {
  client: BifrostClient;
  listCustomers: ReturnType<typeof vi.fn>;
  createCustomer: ReturnType<typeof vi.fn>;
  listVirtualKeys: ReturnType<typeof vi.fn>;
  createVirtualKey: ReturnType<typeof vi.fn>;
} {
  const listCustomers = vi.fn();
  const createCustomer = vi.fn();
  const listVirtualKeys = vi.fn();
  const createVirtualKey = vi.fn();
  const client = {
    listCustomers,
    createCustomer,
    listVirtualKeys,
    createVirtualKey,
  } as unknown as BifrostClient;
  return { client, listCustomers, createCustomer, listVirtualKeys, createVirtualKey };
}

describe("reconcileBifrostVK (integration)", () => {
  let workspaceId: string;
  let userId: string;
  let memberId: string;

  beforeEach(async () => {
    const owner = await createTestUser({ name: "Owner" });
    const user = await createTestUser({ name: "Alice" });
    userId = user.id;

    const workspace = await createTestWorkspace({
      ownerId: owner.id,
      name: "Bifrost VK Test WS",
    });
    workspaceId = workspace.id;

    const member = await createTestMembership({
      workspaceId,
      userId,
      role: "DEVELOPER",
    });
    memberId = member.id;

    // Swarm with Bifrost admin creds. Password is encrypted at rest like
    // any other secret.
    const enc = EncryptionService.getInstance();
    await createTestSwarm({
      workspaceId,
      name: `swarm-bifrost-${Date.now()}`,
      swarmUrl: "https://swarm.test.sphinx.chat",
    });
    // The factory doesn't know about bifrost fields; set them directly.
    await db.swarm.update({
      where: { workspaceId },
      data: {
        bifrostAdminUser: "admin",
        bifrostAdminPassword: JSON.stringify(
          enc.encryptField("bifrostAdminPassword", "s3cret"),
        ),
      },
    });
  });

  it("creates customer + VK on first call and persists the encrypted VK", async () => {
    const { client, listCustomers, createCustomer, listVirtualKeys, createVirtualKey } =
      makeClientStub();
    listCustomers.mockResolvedValue({
      customers: [],
      count: 0,
      total_count: 0,
      limit: 50,
      offset: 0,
    });
    createCustomer.mockResolvedValue({
      message: "ok",
      customer: { id: "cust-1", name: userId, created_at: "2026-01-01" },
    });
    listVirtualKeys.mockResolvedValue({
      virtual_keys: [],
      count: 0,
      total_count: 0,
      limit: 50,
      offset: 0,
    });
    createVirtualKey.mockResolvedValue({
      message: "ok",
      virtual_key: {
        id: "vk-1",
        name: userId,
        value: "sk-bf-LIVE-1",
        customer_id: "cust-1",
        created_at: "2026-01-01",
      },
    });

    const result = await reconcileBifrostVK(workspaceId, userId, {
      clientFactory: () => client,
    });

    expect(result.vkValue).toBe("sk-bf-LIVE-1");
    expect(result.customerId).toBe("cust-1");
    expect(result.vkId).toBe("vk-1");
    // No `model` option supplied -> default provider (anthropic).
    expect(result.baseUrl).toBe(
      "https://swarm.test.sphinx.chat:8181/anthropic/v1",
    );
    expect(result.created).toBe(true);

    // Persisted on the WorkspaceMember row, encrypted.
    const row = await db.workspaceMember.findUnique({
      where: { id: memberId },
      select: {
        bifrostVkValue: true,
        bifrostVkId: true,
        bifrostCustomerId: true,
        bifrostSyncedAt: true,
      },
    });
    expect(row?.bifrostVkId).toBe("vk-1");
    expect(row?.bifrostCustomerId).toBe("cust-1");
    expect(row?.bifrostSyncedAt).toBeInstanceOf(Date);
    expect(row?.bifrostVkValue).toBeTruthy();
    // Encrypted at rest — must not equal the cleartext.
    expect(row?.bifrostVkValue).not.toBe("sk-bf-LIVE-1");
    // Round-trip decrypt.
    const enc = EncryptionService.getInstance();
    const parsed = JSON.parse(row!.bifrostVkValue!);
    const decrypted = enc.decryptField("bifrostVk", parsed);
    expect(decrypted).toBe("sk-bf-LIVE-1");
  });

  it("is idempotent: second call hits the DB cache, no Bifrost HTTP", async () => {
    const first = makeClientStub();
    first.listCustomers.mockResolvedValue({
      customers: [],
      count: 0,
      total_count: 0,
      limit: 50,
      offset: 0,
    });
    first.createCustomer.mockResolvedValue({
      message: "ok",
      customer: { id: "cust-1", name: userId, created_at: "2026-01-01" },
    });
    first.listVirtualKeys.mockResolvedValue({
      virtual_keys: [],
      count: 0,
      total_count: 0,
      limit: 50,
      offset: 0,
    });
    first.createVirtualKey.mockResolvedValue({
      message: "ok",
      virtual_key: {
        id: "vk-1",
        name: userId,
        value: "sk-bf-LIVE-2",
        customer_id: "cust-1",
        created_at: "2026-01-01",
      },
    });

    const r1 = await reconcileBifrostVK(workspaceId, userId, {
      clientFactory: () => first.client,
    });
    expect(r1.created).toBe(true);

    // Second call: a brand-new client. If the reconciler tries to use it
    // at all, the test fails because all methods are unstubbed.
    const second = makeClientStub();
    const r2 = await reconcileBifrostVK(workspaceId, userId, {
      clientFactory: () => second.client,
    });

    expect(r2.vkValue).toBe("sk-bf-LIVE-2");
    expect(r2.created).toBe(false);
    expect(second.listCustomers).not.toHaveBeenCalled();
    expect(second.createCustomer).not.toHaveBeenCalled();
    expect(second.listVirtualKeys).not.toHaveBeenCalled();
    expect(second.createVirtualKey).not.toHaveBeenCalled();
  });
});
