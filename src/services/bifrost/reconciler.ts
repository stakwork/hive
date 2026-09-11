import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { withLock } from "@/lib/locks/redis-lock";
import { gatewayUrlForModel, getProviderForModel } from "aieo";

import { BifrostClient, BifrostHttpError } from "./BifrostClient";
import {
  AIEO_TO_BIFROST_PROVIDER,
  BIFROST_LOCK_ACQUIRE_TIMEOUT_MS,
  BIFROST_LOCK_PREFIX,
  BIFROST_LOCK_TTL_MS,
  BIFROST_LOG_TAG,
  BIFROST_VK_PROVIDER_MISS_REFRESH_MS,
  BIFROST_VK_PROVIDER_REFRESH_MS,
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
  BifrostProvider,
  BifrostProviderConfig,
  BifrostVirtualKey,
  ReconcileResult,
} from "./types";

/**
 * Phase-1 Hive VK Reconciler.
 *
 * For a `(workspaceId, userId)` pair, ensure the workspace's Bifrost
 * has one Customer and one VK named `{githubLogin}-{userId}` (or just
 * `userId` when the user has no GitHubAuth — e.g. Sphinx-only logins).
 * The Customer gets $1000/day, 1000 RPM / 5M TPM; the VK is attached
 * to that Customer with permissive provider configs. Stash the VK
 * `value` (encrypted) on `WorkspaceMember` keyed by `(workspaceId,
 * userId)`. Idempotent.
 *
 * The `{githubLogin}-{userId}` form is a UX nicety: the Bifrost admin
 * UI lists Customers/VKs by name, and the bare cuid is unreadable.
 * `userId` remains the source of truth for identity; the login is
 * just a display affordance and we never look users up by it.
 *
 * Triggered lazily on first LLM use. Subsequent callers hit the
 * cached VK on `WorkspaceMember` without talking to Bifrost — except
 * once per `BIFROST_VK_PROVIDER_REFRESH_MS`, when the VK's provider
 * grants are re-checked against the gateway (see "Provider grants"
 * below). The grants last observed are snapshotted on the row so a
 * call for a provider the VK doesn't carry can be steered back to
 * the caller's direct key instead of failing at the gateway.
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

  // 1. Fast-path: cached VK on WorkspaceMember. We also grab the
  // user's GitHub login so we can name new Bifrost entities
  // `{login}-{userId}` — purely so the Bifrost admin UI is readable.
  // The login is only consulted on the create path; cached
  // reconciliations don't need it.
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: {
      id: true,
      bifrostVkValue: true,
      bifrostVkId: true,
      bifrostCustomerId: true,
      bifrostSyncedAt: true,
      bifrostVkProviders: true,
      user: {
        select: {
          githubAuth: { select: { githubUsername: true } },
        },
      },
    },
  });
  if (!member) {
    throw new Error(
      `User ${userId} is not a member of workspace ${workspaceId}`,
    );
  }

  const bifrostName = buildBifrostName(
    userId,
    member.user?.githubAuth?.githubUsername ?? null,
  );

  const baseCreds = await resolveBifrost(workspaceId);
  // Suffix the gateway root with the provider path the caller's
  // model needs. The admin URL we keep on `baseCreds.baseUrl` stays
  // root-only — `BifrostClient` below uses that for `/api/governance`
  // calls. The user-facing `baseUrl` we return is what an LLM SDK or
  // downstream agent will call directly, so it needs the provider
  // suffix already applied.
  const llmBaseUrl = gatewayUrlForModel(options.model, baseCreds.baseUrl);
  const modelProvider = bifrostProviderForModel(options.model);

  // Constructing the client is free (no I/O). It's only exercised on
  // the Bifrost paths below — including the cached path's periodic
  // grant refresh.
  const client =
    options.clientFactory?.(baseCreds) ?? new BifrostClient(baseCreds);

  if (
    member.bifrostVkValue &&
    member.bifrostVkId &&
    member.bifrostCustomerId
  ) {
    let vkValue: string | undefined;
    try {
      // `decryptField` parses the stored JSON-stringified ciphertext
      // itself. Don't double-parse.
      vkValue = encryption.decryptField("bifrostVk", member.bifrostVkValue);
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
    if (vkValue !== undefined) {
      // Grant snapshot from the last create / refresh. Empty means
      // unknown (row predates the column, or the gateway couldn't be
      // read) — never "no grants".
      let providers = knownGrants(member.bifrostVkProviders);
      // The cache never talks to Bifrost, so a provider added to
      // DEFAULT_PROVIDERS (or newly configured on this gateway) would
      // otherwise never reach a VK minted before it. Re-check the
      // grants once per refresh window — and sooner, once per miss
      // window, when the caller's model needs a provider the snapshot
      // lacks (or there is no snapshot), so a gateway that just gained
      // a provider flips its cached VKs in minutes rather than a day.
      // Best-effort — never blocks or fails the call.
      const missing =
        providers === undefined || !providers.includes(modelProvider);
      if (
        isProviderGrantStale(
          member.bifrostSyncedAt,
          BIFROST_VK_PROVIDER_REFRESH_MS,
        ) ||
        (missing &&
          isProviderGrantStale(
            member.bifrostSyncedAt,
            BIFROST_VK_PROVIDER_MISS_REFRESH_MS,
          ))
      ) {
        const refreshed = await refreshProviderGrants(
          client,
          member.bifrostVkId,
          member.id,
        );
        if (refreshed) providers = refreshed;
      }
      return {
        workspaceId,
        userId,
        customerId: member.bifrostCustomerId,
        vkId: member.bifrostVkId,
        vkValue,
        baseUrl: llmBaseUrl,
        created: false,
        modelProvider,
        providers,
        modelProviderGranted: isGranted(providers, modelProvider),
      };
    }
  }

  // 2. Talk to Bifrost.
  let created = false;

  const { customer, createdCustomer } = await ensureCustomer(
    client,
    bifrostName,
  );
  if (createdCustomer) created = true;

  const providers = await desiredProviders(client);
  const { virtualKey, createdVk, granted } = await ensureVirtualKey(
    client,
    bifrostName,
    customer.id,
    providers,
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
      // Empty when the grants couldn't be observed — read as "unknown"
      // by the cached path, which then refreshes on its next miss.
      bifrostVkProviders: granted ?? [],
    },
  });

  logger.info("Bifrost VK reconciled", BIFROST_LOG_TAG, {
    workspaceId,
    userId,
    bifrostName,
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
    modelProvider,
    providers: granted,
    modelProviderGranted: isGranted(granted, modelProvider),
  };
}

async function ensureCustomer(
  client: BifrostClient,
  name: string,
): Promise<{ customer: BifrostCustomer; createdCustomer: boolean }> {
  const existing = await findExactCustomer(client, name);
  if (existing) return { customer: existing, createdCustomer: false };

  // None — create. If a concurrent caller wins the create race (Bifrost
  // has no built-in unique-name check on the handler, but the DB has
  // an index — line 372 of the plan), the create returns 400 with a
  // "duplicate key" body. Per the plan §4, we treat this as success
  // and read back. The mutex makes this rare; this is defense in depth.
  try {
    const created = await client.createCustomer({
      name,
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
      const readback = await findExactCustomer(client, name);
      if (readback) {
        logger.warn(
          "Bifrost Customer create raced; using readback",
          BIFROST_LOG_TAG,
          { name, picked: readback.id },
        );
        return { customer: readback, createdCustomer: false };
      }
    }
    throw err;
  }
}

async function findExactCustomer(
  client: BifrostClient,
  name: string,
): Promise<BifrostCustomer | null> {
  // Bifrost's `search` is substring matching, so filter to exact name.
  const list = await client.listCustomers({ search: name, limit: 50 });
  const exact = list.customers.filter((c) => c.name === name);

  if (exact.length === 0) return null;
  if (exact.length === 1) return exact[0];

  const oldest = pickOldest(exact);
  logger.warn(
    "Multiple Bifrost Customers found with the same name; using oldest",
    BIFROST_LOG_TAG,
    { name, found: exact.length, picked: oldest.id },
  );
  return oldest;
}

async function ensureVirtualKey(
  client: BifrostClient,
  name: string,
  customerId: string,
  providers: BifrostProvider[],
): Promise<{
  virtualKey: BifrostVirtualKey;
  createdVk: boolean;
  /** Providers the VK carries after this call; undefined when unobserved. */
  granted?: string[];
}> {
  const existing = await findExactVirtualKey(client, name, customerId);
  if (existing) {
    let granted = grantsOf(existing);
    // Non-fatal: the VK already works for the providers it has, and
    // failing here would make the orchestrator drop this call to the
    // swarm's default key over a grant it may not even need.
    try {
      const topped = await topUpProviderGrants(client, existing, providers);
      if (topped.granted) granted = topped.granted;
    } catch (err) {
      logger.warn(
        "Bifrost VK provider top-up failed; using VK as is",
        BIFROST_LOG_TAG,
        {
          name,
          customerId,
          vkId: existing.id,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
    return { virtualKey: existing, createdVk: false, granted };
  }

  try {
    const created = await client.createVirtualKey({
      name,
      description: `Hive user ${name} — auto-provisioned`,
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
      provider_configs: providers.map((provider) => ({
        provider,
        allowed_models: ["*"],
        key_ids: ["*"],
      })),
    });
    // What we asked for is what the VK carries: Bifrost 400s the whole
    // create on a provider it lacks rather than dropping that entry.
    return { virtualKey: created.virtual_key, createdVk: true, granted: providers };
  } catch (err) {
    // VK names are uniquely indexed at the DB level (plan §4). On a
    // dup-key race, read back per the plan.
    if (isDuplicateKeyError(err)) {
      const readback = await findExactVirtualKey(client, name, customerId);
      if (readback) {
        logger.warn(
          "Bifrost VK create raced; using readback",
          BIFROST_LOG_TAG,
          { name, customerId, picked: readback.id },
        );
        return {
          virtualKey: readback,
          createdVk: false,
          granted: grantsOf(readback),
        };
      }
    }
    throw err;
  }
}

async function findExactVirtualKey(
  client: BifrostClient,
  name: string,
  customerId: string,
): Promise<BifrostVirtualKey | null> {
  const list = await client.listVirtualKeys({
    search: name,
    customer_id: customerId,
    limit: 50,
  });
  const exact = list.virtual_keys.filter(
    (vk) => vk.name === name && vk.customer_id === customerId,
  );

  if (exact.length === 0) return null;
  if (exact.length === 1) return exact[0];

  const oldest = pickOldest(exact);
  logger.warn(
    "Multiple Bifrost VKs found for customer/name; using oldest",
    BIFROST_LOG_TAG,
    { name, customerId, found: exact.length, picked: oldest.id },
  );
  return oldest;
}

// ─── Provider grants ──────────────────────────────────────────────────
//
// A VK is granted DEFAULT_PROVIDERS ∩ (providers configured on this
// gateway). Bifrost validates every `provider_configs[].provider`
// against its configured providers on create *and* update
// (`getConfiguredProviderSet` in transports/bifrost-http/handlers/
// governance.go), so naming one the gateway lacks 400s the whole
// request — and swarm gateways pick up new providers (xai, via
// stakgraph#1673) on their own deploy cadence. Grants are additive:
// a provider the VK carries but the gateway no longer lists is left
// in place.

/**
 * DEFAULT_PROVIDERS narrowed to what the gateway has configured.
 * Falls back to the full list when the providers endpoint fails or
 * lists none of them — the pre-narrowing behaviour, whose 400 on
 * create surfaces through the orchestrator's fail-open path exactly
 * as it always did.
 */
async function desiredProviders(
  client: BifrostClient,
): Promise<BifrostProvider[]> {
  let configured: Set<string>;
  try {
    const res = await client.listProviders();
    configured = new Set(res.providers.map((p) => p.name));
  } catch (err) {
    logger.warn(
      "Bifrost providers list failed; assuming every default provider",
      BIFROST_LOG_TAG,
      { error: err instanceof Error ? err.message : String(err) },
    );
    return DEFAULT_PROVIDERS;
  }
  const desired = DEFAULT_PROVIDERS.filter((p) => configured.has(p));
  if (desired.length === 0) {
    logger.warn(
      "Bifrost gateway lists none of the default providers; assuming every default provider",
      BIFROST_LOG_TAG,
      { configured: Array.from(configured) },
    );
    return DEFAULT_PROVIDERS;
  }
  return desired;
}

/**
 * Grant the VK any of `desired` it doesn't already carry. Returns the
 * providers added (empty when nothing changed) and the providers the
 * VK carries afterwards (undefined when the response didn't say).
 *
 * Bifrost's PUT replaces the provider_configs set wholesale: entries
 * with an `id` update in place, entries without one are created, and
 * any existing config missing from the request is DELETED. So every
 * existing config is re-sent verbatim alongside the new ones. Budgets
 * and rate limits are omitted, which Bifrost treats as "unchanged".
 */
async function topUpProviderGrants(
  client: BifrostClient,
  vk: BifrostVirtualKey,
  desired: BifrostProvider[],
): Promise<{ added: BifrostProvider[]; granted?: string[] }> {
  const existing = vk.provider_configs;
  // Without the hydrated set (ids included) we can't re-send it, and
  // a PUT that omits a config deletes it. Leave the VK alone — but the
  // provider names are still a faithful reading of what it carries.
  if (!Array.isArray(existing) || existing.some((pc) => pc.id == null)) {
    logger.warn(
      "Bifrost VK response lacks hydrated provider_configs; skipping grant top-up",
      BIFROST_LOG_TAG,
      { vkId: vk.id },
    );
    return { added: [], granted: grantsOf(vk) };
  }
  const have = existing.map((pc) => pc.provider);
  const haveSet = new Set(have);
  const missing = desired.filter((p) => !haveSet.has(p));
  if (missing.length === 0) return { added: [], granted: have };

  await client.updateVirtualKey(vk.id, {
    provider_configs: [
      ...existing.map(carryProviderConfig),
      ...missing.map((provider) => ({
        provider,
        allowed_models: ["*"],
        key_ids: ["*"],
      })),
    ],
  });
  logger.info("Bifrost VK provider grants topped up", BIFROST_LOG_TAG, {
    vkId: vk.id,
    added: missing,
  });
  return { added: missing, granted: [...have, ...missing] };
}

/**
 * Re-encode a hydrated (response-side) provider_config as the
 * request-side shape so an update carries it through unchanged. The
 * key grant round-trips from `allow_all_keys` / `keys[].key_id` back
 * to `key_ids` — leaving `key_ids` off would strip the VK's keys.
 */
function carryProviderConfig(pc: BifrostProviderConfig) {
  return {
    id: pc.id,
    provider: pc.provider,
    allowed_models: pc.allowed_models ?? [],
    blacklisted_models: pc.blacklisted_models ?? [],
    weight: pc.weight ?? undefined,
    key_ids: pc.allow_all_keys
      ? ["*"]
      : (pc.keys ?? [])
          .map((k) => k.key_id)
          .filter((id): id is string => typeof id === "string"),
  };
}

/**
 * Cached-path companion to `topUpProviderGrants`: fetch the cached VK
 * from the gateway, grant anything it's missing, then stamp
 * `bifrostSyncedAt` (and the grant snapshot, when observed) so the
 * next check is a refresh window away. Returns the grants observed,
 * or undefined when the gateway couldn't be read.
 *
 * Best-effort throughout. Any failure is logged and the cached VK is
 * served as is — an LLM call must never fail because a grant refresh
 * did. The stamp is written even on failure so a persistently
 * unhappy gateway costs one extra round-trip per window, not per call.
 */
async function refreshProviderGrants(
  client: BifrostClient,
  vkId: string,
  memberId: string,
): Promise<string[] | undefined> {
  let granted: string[] | undefined;
  try {
    const desired = await desiredProviders(client);
    const { virtual_key } = await client.getVirtualKey(vkId);
    granted = (await topUpProviderGrants(client, virtual_key, desired)).granted;
  } catch (err) {
    logger.warn(
      "Bifrost VK grant refresh failed; serving cached VK",
      BIFROST_LOG_TAG,
      { vkId, error: err instanceof Error ? err.message : String(err) },
    );
  }
  try {
    await db.workspaceMember.update({
      where: { id: memberId },
      data: {
        bifrostSyncedAt: new Date(),
        // Only overwrite the snapshot when this refresh actually saw
        // the VK; a failed read must not blank a good one.
        ...(granted ? { bifrostVkProviders: granted } : {}),
      },
    });
  } catch (err) {
    logger.warn(
      "Failed to stamp bifrostSyncedAt after grant refresh",
      BIFROST_LOG_TAG,
      { memberId, error: err instanceof Error ? err.message : String(err) },
    );
  }
  return granted;
}

function isProviderGrantStale(
  syncedAt: Date | null | undefined,
  windowMs: number,
): boolean {
  if (!syncedAt) return true;
  return Date.now() - syncedAt.getTime() > windowMs;
}

/**
 * Bifrost provider id for the model a caller intends to use — the
 * same prefix resolution `gatewayUrlForModel` applies to the base URL
 * (shortcuts like `"grok"`, namespaced ids like `"xai/grok-4.6"`, bare
 * ids, anthropic when omitted), mapped through
 * `AIEO_TO_BIFROST_PROVIDER` (`google` → `gemini`).
 */
export function bifrostProviderForModel(
  model: string | undefined,
): BifrostProvider {
  return AIEO_TO_BIFROST_PROVIDER[getProviderForModel(model)];
}

/** Snapshot → known grants. The empty default means "unknown", never "none". */
function knownGrants(
  snapshot: string[] | null | undefined,
): string[] | undefined {
  return snapshot && snapshot.length > 0 ? snapshot : undefined;
}

/** Provider names a VK response carries, or undefined when it doesn't say. */
function grantsOf(vk: BifrostVirtualKey): string[] | undefined {
  return Array.isArray(vk.provider_configs)
    ? vk.provider_configs.map((pc) => pc.provider)
    : undefined;
}

function isGranted(
  providers: string[] | undefined,
  provider: string,
): boolean | undefined {
  return providers === undefined ? undefined : providers.includes(provider);
}

/**
 * Build the human-readable Bifrost Customer/VK name for a user.
 *
 * Format: `{githubLogin}-{userId}` when we have a GitHub login,
 * otherwise the bare `userId`. The login is a display nicety only —
 * the trailing `userId` is what makes the name unique and what we'd
 * grep for; everything keyed off identity (cache, locks, lookups)
 * stays on `userId`.
 *
 * GitHub logins are already constrained to `[A-Za-z0-9-]` (≤39 chars),
 * so no extra sanitization is needed. We still guard against an empty
 * string just in case a `GitHubAuth` row exists with a blank
 * `githubUsername`.
 */
export function buildBifrostName(
  userId: string,
  githubLogin: string | null,
): string {
  const login = githubLogin?.trim();
  return login ? `${login}-${userId}` : userId;
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
