import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { withLock } from "@/lib/locks/redis-lock";
import type { EncryptedData } from "@/types/encryption";

import { BifrostClient } from "./BifrostClient";
import {
  BIFROST_LOCK_ACQUIRE_TIMEOUT_MS,
  BIFROST_LOCK_PREFIX,
  BIFROST_LOCK_TTL_MS,
  BIFROST_LOG_TAG,
  DEFAULT_BUDGET_RESET_DURATION,
  DEFAULT_CUSTOMER_BUDGET_USD,
  DEFAULT_PROVIDERS,
  DEFAULT_RATE_LIMIT_RESET_DURATION,
  DEFAULT_REQUEST_MAX_LIMIT,
  DEFAULT_TOKEN_MAX_LIMIT,
} from "./constants";
import { resolveBifrost } from "./resolve";
import type {
  BifrostCustomer,
  BifrostVirtualKey,
  ReconcileResult,
} from "./types";

/**
 * Phase-1 Hive VK Reconciler.
 *
 * For a `(workspaceId, userId)` pair, ensure the workspace's Bifrost
 * has one Customer (`name=userId`, $1000/day, 1000 RPM / 5M TPM) and
 * one VK (`name=userId`, attached to that Customer, permissive
 * provider configs). Stash the VK `value` (encrypted) on
 * `WorkspaceMember` keyed by `(workspaceId, userId)`. Idempotent.
 *
 * Triggered lazily on first LLM use. Subsequent callers hit the
 * cached VK on `WorkspaceMember` without ever talking to Bifrost.
 *
 * See `gateway/plans/phase-1-reconciler.md`.
 */

export interface ReconcileOptions {
  /** Inject a client (tests). */
  clientFactory?: (opts: {
    baseUrl: string;
    adminUser: string;
    adminPassword: string;
  }) => BifrostClient;
}

export async function reconcileBifrostVK(
  workspaceId: string,
  userId: string,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const lockKey = `${BIFROST_LOCK_PREFIX}:${workspaceId}:${userId}`;

  return withLock(
    lockKey,
    () => doReconcile(workspaceId, userId, options),
    {
      ttlMs: BIFROST_LOCK_TTL_MS,
      acquireTimeoutMs: BIFROST_LOCK_ACQUIRE_TIMEOUT_MS,
    },
  );
}

async function doReconcile(
  workspaceId: string,
  userId: string,
  options: ReconcileOptions,
): Promise<ReconcileResult> {
  const encryption = EncryptionService.getInstance();

  // 1. Fast-path: cached VK on WorkspaceMember.
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: {
      id: true,
      bifrostVkValue: true,
      bifrostVkId: true,
      bifrostCustomerId: true,
    },
  });
  if (!member) {
    throw new Error(
      `User ${userId} is not a member of workspace ${workspaceId}`,
    );
  }

  const baseCreds = await resolveBifrost(workspaceId);

  if (
    member.bifrostVkValue &&
    member.bifrostVkId &&
    member.bifrostCustomerId
  ) {
    try {
      const parsed = JSON.parse(member.bifrostVkValue) as EncryptedData;
      const vkValue = encryption.decryptField("bifrostVk", parsed);
      return {
        workspaceId,
        userId,
        customerId: member.bifrostCustomerId,
        vkId: member.bifrostVkId,
        vkValue,
        baseUrl: baseCreds.baseUrl,
        created: false,
      };
    } catch (err) {
      // Corrupt encryption blob — fall through to re-provision.
      logger.warn(
        "Cached Bifrost VK failed to decrypt; will re-reconcile",
        BIFROST_LOG_TAG,
        {
          workspaceId,
          userId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  // 2. Talk to Bifrost.
  const client =
    options.clientFactory?.(baseCreds) ?? new BifrostClient(baseCreds);

  let created = false;

  const { customer, createdCustomer } = await ensureCustomer(client, userId);
  if (createdCustomer) created = true;

  const { virtualKey, createdVk } = await ensureVirtualKey(
    client,
    userId,
    customer.id,
  );
  if (createdVk) created = true;

  // 3. Persist (encrypted) on WorkspaceMember.
  const encryptedVk = JSON.stringify(
    encryption.encryptField("bifrostVk", virtualKey.value),
  );
  await db.workspaceMember.update({
    where: { id: member.id },
    data: {
      bifrostVkValue: encryptedVk,
      bifrostVkId: virtualKey.id,
      bifrostCustomerId: customer.id,
      bifrostSyncedAt: new Date(),
    },
  });

  logger.info("Bifrost VK reconciled", BIFROST_LOG_TAG, {
    workspaceId,
    userId,
    customerId: customer.id,
    vkId: virtualKey.id,
    created,
  });

  return {
    workspaceId,
    userId,
    customerId: customer.id,
    vkId: virtualKey.id,
    vkValue: virtualKey.value,
    baseUrl: baseCreds.baseUrl,
    created,
  };
}

async function ensureCustomer(
  client: BifrostClient,
  userId: string,
): Promise<{ customer: BifrostCustomer; createdCustomer: boolean }> {
  // Bifrost's `search` is substring matching, so filter to exact name.
  const list = await client.listCustomers({ search: userId, limit: 50 });
  const exact = list.customers.filter((c) => c.name === userId);

  if (exact.length === 1) {
    return { customer: exact[0], createdCustomer: false };
  }
  if (exact.length > 1) {
    // Multiple — pick oldest by created_at and warn. Don't auto-dedupe in phase 1.
    const oldest = pickOldest(exact);
    logger.warn(
      "Multiple Bifrost Customers found with the same name; using oldest",
      BIFROST_LOG_TAG,
      { userId, found: exact.length, picked: oldest.id },
    );
    return { customer: oldest, createdCustomer: false };
  }

  // None — create.
  const created = await client.createCustomer({
    name: userId,
    budget: {
      max_limit: DEFAULT_CUSTOMER_BUDGET_USD,
      reset_duration: DEFAULT_BUDGET_RESET_DURATION,
    },
    rate_limit: {
      request_max_limit: DEFAULT_REQUEST_MAX_LIMIT,
      request_reset_duration: DEFAULT_RATE_LIMIT_RESET_DURATION,
      token_max_limit: DEFAULT_TOKEN_MAX_LIMIT,
      token_reset_duration: DEFAULT_RATE_LIMIT_RESET_DURATION,
    },
  });
  return { customer: created.customer, createdCustomer: true };
}

async function ensureVirtualKey(
  client: BifrostClient,
  userId: string,
  customerId: string,
): Promise<{ virtualKey: BifrostVirtualKey; createdVk: boolean }> {
  const list = await client.listVirtualKeys({
    search: userId,
    customer_id: customerId,
    limit: 50,
  });
  const exact = list.virtual_keys.filter(
    (vk) => vk.name === userId && vk.customer_id === customerId,
  );

  if (exact.length === 1) {
    return { virtualKey: exact[0], createdVk: false };
  }
  if (exact.length > 1) {
    const oldest = pickOldest(exact);
    logger.warn(
      "Multiple Bifrost VKs found for customer/name; using oldest",
      BIFROST_LOG_TAG,
      { userId, customerId, found: exact.length, picked: oldest.id },
    );
    return { virtualKey: oldest, createdVk: false };
  }

  const created = await client.createVirtualKey({
    name: userId,
    description: `Hive user ${userId} — auto-provisioned`,
    customer_id: customerId,
    provider_configs: DEFAULT_PROVIDERS.map((provider) => ({
      provider,
      allowed_models: ["*"],
    })),
  });
  return { virtualKey: created.virtual_key, createdVk: true };
}

function pickOldest<T extends { created_at: string }>(items: T[]): T {
  return items.reduce((oldest, cur) =>
    cur.created_at < oldest.created_at ? cur : oldest,
  );
}
