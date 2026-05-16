import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { withLock } from "@/lib/locks/redis-lock";
import { gatewayUrlForModel } from "aieo";

import { BifrostClient, BifrostHttpError } from "./BifrostClient";
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
  /**
   * Model the caller intends to use against the returned VK.
   * Determines the per-provider suffix on the returned `baseUrl`
   * (e.g. `/anthropic/v1`, `/openai/v1`, `/genai/v1beta`).
   *
   * Accepts shortcuts (`"sonnet"`, `"opus"`, `"gpt"`, `"gemini"`,
   * `"kimi"`), namespaced ids (`"anthropic/claude-sonnet-4-6"`),
   * or full provider model ids. Falls back to the default provider
   * (anthropic) when omitted — safe for callers that just need a
   * working URL and will use Anthropic models.
   *
   * Internal admin calls (`BifrostClient` -> `/api/governance/*`)
   * always use the gateway root regardless of this option; only the
   * `baseUrl` we return to the caller is suffixed.
   */
  model?: string;
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
  // Suffix the gateway root with the provider path the caller's
  // model needs. The admin URL we keep on `baseCreds.baseUrl` stays
  // root-only — `BifrostClient` below uses that for `/api/governance`
  // calls. The user-facing `baseUrl` we return is what an LLM SDK or
  // downstream agent will call directly, so it needs the provider
  // suffix already applied.
  const llmBaseUrl = gatewayUrlForModel(options.model, baseCreds.baseUrl);

  if (
    member.bifrostVkValue &&
    member.bifrostVkId &&
    member.bifrostCustomerId
  ) {
    try {
      // `decryptField` parses the stored JSON-stringified ciphertext
      // itself. Don't double-parse.
      const vkValue = encryption.decryptField(
        "bifrostVk",
        member.bifrostVkValue,
      );
      return {
        workspaceId,
        userId,
        customerId: member.bifrostCustomerId,
        vkId: member.bifrostVkId,
        vkValue,
        baseUrl: llmBaseUrl,
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
    baseUrl: llmBaseUrl,
    created,
  };
}

async function ensureCustomer(
  client: BifrostClient,
  userId: string,
): Promise<{ customer: BifrostCustomer; createdCustomer: boolean }> {
  const existing = await findExactCustomer(client, userId);
  if (existing) return { customer: existing, createdCustomer: false };

  // None — create. If a concurrent caller wins the create race (Bifrost
  // has no built-in unique-name check on the handler, but the DB has
  // an index — line 372 of the plan), the create returns 400 with a
  // "duplicate key" body. Per the plan §4, we treat this as success
  // and read back. The mutex makes this rare; this is defense in depth.
  try {
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
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const readback = await findExactCustomer(client, userId);
      if (readback) {
        logger.warn(
          "Bifrost Customer create raced; using readback",
          BIFROST_LOG_TAG,
          { userId, picked: readback.id },
        );
        return { customer: readback, createdCustomer: false };
      }
    }
    throw err;
  }
}

async function findExactCustomer(
  client: BifrostClient,
  userId: string,
): Promise<BifrostCustomer | null> {
  // Bifrost's `search` is substring matching, so filter to exact name.
  const list = await client.listCustomers({ search: userId, limit: 50 });
  const exact = list.customers.filter((c) => c.name === userId);

  if (exact.length === 0) return null;
  if (exact.length === 1) return exact[0];

  const oldest = pickOldest(exact);
  logger.warn(
    "Multiple Bifrost Customers found with the same name; using oldest",
    BIFROST_LOG_TAG,
    { userId, found: exact.length, picked: oldest.id },
  );
  return oldest;
}

async function ensureVirtualKey(
  client: BifrostClient,
  userId: string,
  customerId: string,
): Promise<{ virtualKey: BifrostVirtualKey; createdVk: boolean }> {
  const existing = await findExactVirtualKey(client, userId, customerId);
  if (existing) return { virtualKey: existing, createdVk: false };

  try {
    const created = await client.createVirtualKey({
      name: userId,
      description: `Hive user ${userId} — auto-provisioned`,
      customer_id: customerId,
      // `key_ids: ["*"]` tells Bifrost to set `allow_all_keys: true` on
      // each provider_config — i.e. the VK is permitted to use every
      // provider-level API key configured on the gateway. Without this,
      // Bifrost defaults to "no attached keys" and inference fails with
      // `no keys found for provider: <p> and model: <m>` (even though
      // the provider key clearly exists). The field name is `key_ids`
      // on the request, NOT `keys` — the response-side `keys` array is
      // a different (hydrated, read-only) field. See the Bifrost Go
      // handler: `KeyIDs schemas.WhiteList json:"key_ids"` in
      // transports/bifrost-http/handlers/governance.go.
      provider_configs: DEFAULT_PROVIDERS.map((provider) => ({
        provider,
        allowed_models: ["*"],
        key_ids: ["*"],
      })),
    });
    return { virtualKey: created.virtual_key, createdVk: true };
  } catch (err) {
    // VK names are uniquely indexed at the DB level (plan §4). On a
    // dup-key race, read back per the plan.
    if (isDuplicateKeyError(err)) {
      const readback = await findExactVirtualKey(client, userId, customerId);
      if (readback) {
        logger.warn(
          "Bifrost VK create raced; using readback",
          BIFROST_LOG_TAG,
          { userId, customerId, picked: readback.id },
        );
        return { virtualKey: readback, createdVk: false };
      }
    }
    throw err;
  }
}

async function findExactVirtualKey(
  client: BifrostClient,
  userId: string,
  customerId: string,
): Promise<BifrostVirtualKey | null> {
  const list = await client.listVirtualKeys({
    search: userId,
    customer_id: customerId,
    limit: 50,
  });
  const exact = list.virtual_keys.filter(
    (vk) => vk.name === userId && vk.customer_id === customerId,
  );

  if (exact.length === 0) return null;
  if (exact.length === 1) return exact[0];

  const oldest = pickOldest(exact);
  logger.warn(
    "Multiple Bifrost VKs found for customer/name; using oldest",
    BIFROST_LOG_TAG,
    { userId, customerId, found: exact.length, picked: oldest.id },
  );
  return oldest;
}

function isDuplicateKeyError(err: unknown): boolean {
  if (!(err instanceof BifrostHttpError)) return false;
  if (err.status !== 400) return false;
  return /duplicate key|already exists|UNIQUE constraint/i.test(err.message);
}

function pickOldest<T extends { created_at: string }>(items: T[]): T {
  return items.reduce((oldest, cur) =>
    cur.created_at < oldest.created_at ? cur : oldest,
  );
}
