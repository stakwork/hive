import type { BifrostProvider } from "./types";

/**
 * Phase-1 defaults for Bifrost Customer + VK provisioning, per
 * `phase-1-reconciler.md`. These live in one place so a future
 * config-driven version can swap them out without hunting through
 * call sites.
 */

/** Customer-level daily spend cap in USD. */
export const DEFAULT_CUSTOMER_BUDGET_USD = 1000.0;

/** Customer-level budget reset window. */
export const DEFAULT_BUDGET_RESET_DURATION = "1d";

/** Customer-level request rate limit (requests per minute). */
export const DEFAULT_REQUEST_MAX_LIMIT = 1000;

/** Customer-level token rate limit (tokens per minute). */
export const DEFAULT_TOKEN_MAX_LIMIT = 5_000_000;

/** Window for both request and token rate limits. */
export const DEFAULT_RATE_LIMIT_RESET_DURATION = "1m";

/**
 * Providers the VK is allowed to call. Permissive by default — the
 * Customer-level budget is the spend ceiling. Add a provider here to
 * make it usable through Bifrost; absent providers are deny-by-default.
 */
export const DEFAULT_PROVIDERS: BifrostProvider[] = [
  "anthropic",
  "openai",
  "openrouter",
  "gemini",
];

/** Default Bifrost admin-API port. Bifrost serves admin on 8181. */
export const DEFAULT_BIFROST_PORT = 8181;

/** Redis key prefix for per-(workspace,user) reconcile mutex. */
export const BIFROST_LOCK_PREFIX = "bifrost-vk:lock";

/** TTL for the reconcile lock — bounded above expected reconcile time. */
export const BIFROST_LOCK_TTL_MS = 30_000;

/** How long to wait to acquire the reconcile lock before giving up. */
export const BIFROST_LOCK_ACQUIRE_TIMEOUT_MS = 20_000;

/** Default per-call HTTP timeout for Bifrost admin requests. */
export const BIFROST_HTTP_TIMEOUT_MS = 15_000;

/** Log tag used by all Bifrost-related logger calls. */
export const BIFROST_LOG_TAG = "BIFROST_VK";

// ─── Phase-5 trust registry ────────────────────────────────────────────
//
// Two reconcilers chain in front of the VK reconciler:
//   1. ensureMacaroonOrgKeys  — autogenerates the org's macaroon
//      signing keypair on first use (custodial, phase-1 of
//      cryptographic-identity.md).
//   2. ensureBifrostTrust     — registers the org pubkey with the
//      workspace's plugin via `/_plugin/trust`. Cached by
//      (orgId, pubkey) on the Swarm row; only re-syncs on mismatch.
//
// Both are lazy, triggered from `getBifrostForLLM` (the master
// reconciler in `orchestrator.ts`). Failure on either is logged
// and swallowed — the VK reconciler still runs and LLM calls
// continue (macaroon enforcement is off through phase 5).

/** Redis key prefix for the per-SourceControlOrg keygen mutex. */
export const MACAROON_ORG_LOCK_PREFIX = "macaroon-org:lock";

/** Redis key prefix for the per-workspace trust reconcile mutex. */
export const BIFROST_TRUST_LOCK_PREFIX = "bifrost-trust:lock";

/** TTL for the trust / org-keys reconcile locks. */
export const BIFROST_TRUST_LOCK_TTL_MS = 30_000;

/** How long to wait to acquire the trust / org-keys lock. */
export const BIFROST_TRUST_LOCK_ACQUIRE_TIMEOUT_MS = 20_000;

/** Log tag for trust reconciliation. */
export const BIFROST_TRUST_LOG_TAG = "BIFROST_TRUST";

/** Log tag for org macaroon key autogen. */
export const MACAROON_ORG_LOG_TAG = "MACAROON_ORG";

/**
 * `revocation_poll_seconds` value the plugin will store when we
 * register an org. The plugin doesn't actively poll yet (revocation
 * is phase 6+), but the field is required on the trust entry and
 * sets the future polling cadence.
 */
export const DEFAULT_REVOCATION_POLL_SECONDS = 60;

/**
 * Stable prefix on macaroon org_id strings derived from a
 * SourceControlOrg.githubLogin. `gh_stakwork` etc.
 */
export const MACAROON_ORG_ID_PREFIX = "gh_";

// ─── Phase-4 per-user macaroon identity ──────────────────────────────
//
// Each user owns one ed25519 keypair that signs every invocation
// macaroon. Custodial in phase 1 — Hive holds the privkey encrypted
// at rest and signs on the user's behalf. Phase 2+ moves the privkey
// off the platform (Yubikey / Passkey / Sphinx app); the wire format
// doesn't change, only the signer location does.

/** Redis key prefix for the per-User keygen mutex. */
export const MACAROON_USER_LOCK_PREFIX = "macaroon-user:lock";

/** Log tag for user macaroon key autogen. */
export const MACAROON_USER_LOG_TAG = "MACAROON_USER";

/** Log tag for the macaroon-issuer hot path. */
export const MACAROON_ISSUER_LOG_TAG = "MACAROON_ISSUER";

/**
 * Default per-invocation budget. Conservative — the per-call cap in
 * v2's threat model. Callers narrow further per agent.
 */
export const MACAROON_DEFAULT_MAX_COST_USD = 100.0;

/** Default per-invocation step budget. */
export const MACAROON_DEFAULT_MAX_STEPS = 2000;

/**
 * Default macaroon TTL — long enough to cover a single agent run with
 * polling, short enough that a stolen macaroon expires before it can
 * do material damage. Caller can shorten per call site.
 */
export const MACAROON_DEFAULT_TTL_SECONDS = 3600;
