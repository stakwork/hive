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
