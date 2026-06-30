/**
 * Wire shapes for Bifrost's `/api/governance` endpoints used by the
 * VK reconciler. Mirrors the JSON shapes documented in
 * `phase-1-reconciler.md` (sections 1-4) and matches the Go handler
 * source in `transports/bifrost-http/handlers/governance.go` in the
 * Bifrost repo.
 *
 * Only fields the reconciler actually reads/writes are typed
 * strictly; the rest are kept loose so a Bifrost-side schema bump
 * (additive) won't break us.
 */

export interface BifrostBudget {
  id?: string;
  max_limit: number; // USD float
  reset_duration: string; // e.g. "1d"
  current_usage?: number;
  last_reset?: string;
}

export interface BifrostRateLimit {
  id?: string;
  request_max_limit?: number | null;
  request_reset_duration?: string | null;
  token_max_limit?: number | null;
  token_reset_duration?: string | null;
}

export interface BifrostCustomer {
  id: string;
  name: string;
  budget_id?: string;
  rate_limit_id?: string;
  budget?: BifrostBudget;
  rate_limit?: BifrostRateLimit;
  teams?: unknown[];
  virtual_keys?: unknown[];
  config_hash?: string;
  created_at: string;
  updated_at?: string;
}

export interface BifrostProviderConfig {
  id?: number;
  virtual_key_id?: string;
  provider: string;
  weight?: number | null;
  /** ["*"] = allow all models; empty array = deny all. */
  allowed_models: string[];
  /**
   * REQUEST-only field. Bifrost maps `["*"]` -> `allow_all_keys: true`;
   * a list of provider-key UUIDs -> attach those specific keys. If
   * omitted, the VK ends up with zero attached keys and every inference
   * fails with "no keys found for provider: …". Field name comes from
   * the Go handler (`KeyIDs json:"key_ids"`) — NOT the same as the
   * response-side `keys` array.
   */
  key_ids?: string[];
  /** Response-side: hydrated provider keys. Read-only from our POV. */
  allow_all_keys?: boolean;
  keys?: unknown[];
  budgets?: unknown[];
  rate_limit?: BifrostRateLimit | null;
}

export interface BifrostVirtualKey {
  id: string;
  name: string;
  description?: string;
  value: string; // "sk-bf-…" bearer token
  is_active?: boolean;
  team_id?: string | null;
  customer_id?: string | null;
  rate_limit_id?: string | null;
  calendar_aligned?: boolean;
  provider_configs?: BifrostProviderConfig[];
  mcp_configs?: unknown[];
  budgets?: unknown[];
  rate_limit?: BifrostRateLimit | null;
  team?: unknown;
  customer?: BifrostCustomer | null;
  created_at: string;
  updated_at?: string;
}

export interface ListCustomersResponse {
  customers: BifrostCustomer[];
  count: number;
  total_count: number;
  limit: number;
  offset: number;
}

export interface CreateCustomerResponse {
  message: string;
  customer: BifrostCustomer;
}

export interface ListVirtualKeysResponse {
  virtual_keys: BifrostVirtualKey[];
  count: number;
  total_count: number;
  limit: number;
  offset: number;
}

export interface CreateVirtualKeyResponse {
  message: string;
  virtual_key: BifrostVirtualKey;
}

/**
 * What `reconcileBifrostVK` returns. `vkValue` is the bearer token
 * (`sk-bf-…`) that callers attach to outbound LLM calls. The other
 * fields are useful for audit / logging.
 */
export interface ReconcileResult {
  workspaceId: string;
  userId: string;
  customerId: string;
  vkId: string;
  vkValue: string;
  /**
   * **Fully-formed per-provider LLM base URL** for the model the
   * caller asked about (or anthropic's path by default).
   * E.g. `https://swarm.example:8181/anthropic/v1`,
   *      `https://swarm.example:8181/openai/v1`,
   *      `https://swarm.example:8181/genai/v1beta`.
   *
   * Hand this straight to an LLM SDK / Goose / workflow node — no
   * additional URL fix-up needed. The gateway root (used for admin
   * calls) lives on `BifrostAdminCreds.baseUrl`; we don't surface it
   * here on purpose so nothing in the LLM path can use the wrong URL.
   */
  baseUrl: string;
  /** True iff Customer or VK was created during this call (audit signal). */
  created: boolean;
}

export interface BifrostAdminCreds {
  baseUrl: string;
  adminUser: string;
  adminPassword: string; // already decrypted
}

/** Provider names Bifrost accepts in `provider_configs[].provider`. */
export type BifrostProvider =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "gemini";

// ─── Phase-5 trust registry wire shapes ────────────────────────────────
//
// These mirror `gateway/internal/trust/types.go` and the doc
// `gateway/plans/phases/phase-5-trust-registry.md`. Auth is Bearer
// (the swarm's provisioning token), NOT Basic — different from the
// governance endpoints.

/** GET /_plugin/trust/status response body. */
export interface TrustStatusResponse {
  claimed: boolean;
  org_count: number;
  orgs: string[];
  seed_source: "env" | "api" | "" | null;
  last_modified: string;
  /**
   * Phase-11: the swarm's own self-identity. Single-swarm
   * deployments leave this unset and the plugin's status omits the
   * field (`omitempty` on the Go side). Multi-swarm deployments
   * set it via `PUT /_plugin/trust/realm_id`; the trust reconciler
   * keeps it in sync with the workspace's slug.
   */
  realm_id?: string;
}

/**
 * PUT /_plugin/trust/realm_id request body. Sending an empty string
 * clears the swarm's self-identity (back to single-swarm mode).
 */
export interface TrustRealmIDRequest {
  realm_id: string;
}

/** PUT /_plugin/trust/realm_id response body. */
export interface TrustRealmIDResponse {
  ok: boolean;
  realm_id: string;
}

/**
 * POST /_plugin/trust request body. The plugin canonicalises the
 * pubkey to lowercase hex on its side, so we send whatever encoding
 * we have on disk and rely on the plugin to normalise.
 */
export interface TrustOrgUpsert {
  org_id: string;
  pubkey: string;
  issuer_url: string;
  revocation_poll_seconds: number;
}

/** POST /_plugin/trust response body. */
export interface TrustUpsertResponse {
  ok: boolean;
  org_id: string;
}

/**
 * GET /_plugin/trust/:org_id response body — the persisted Org row
 * including any active rotation grace state. We only read the fields
 * we care about; grace_pubkeys etc. are passed through opaque.
 */
export interface TrustOrgRow {
  org_id: string;
  pubkey: string;
  issuer_url: string;
  revocation_poll_seconds: number;
  grace_pubkeys?: string[];
  grace_until?: string;
}

// ─── Agent catalog seed ────────────────────────────────────────────────
//
// Wire shapes for the gateway's `POST /_plugin/agents` catalog write.
// Matches `catalogPushRequest` / `catalogPushAgent` in
// `gateway/internal/adminapi/catalog.go`. Hive seeds the default agent
// set (names + default model); prompts/tools/skills are left empty for
// now — the catalog is a registry, edited later in the gateway UI.

/** A prompt the agent uses (system/role instruction). */
export interface AgentCatalogManifestPrompt {
  name: string;
  role?: string;
  body?: string;
  /** Optional per-item source override; defaults to the manifest source. */
  source?: string;
}

/** A tool the agent can call. */
export interface AgentCatalogManifestTool {
  name: string;
  description?: string;
  /** JSON parameter schema, passed through opaque. */
  schema?: unknown;
  source?: string;
}

/** A skill loaded for the agent. */
export interface AgentCatalogManifestSkill {
  name: string;
  description?: string;
  source?: string;
}

/**
 * One agent in the seed manifest. Mirrors `catalogPushAgent` in
 * `gateway/internal/adminapi/catalog.go`.
 *
 * `name` / `display_name` / `description` / `default_model` are the
 * agent's identity; `prompts` / `tools` / `skills` are its
 * capabilities. The Hive seed currently sends identity only — the
 * capability fields are part of the contract but left undefined until
 * they're authored (in the gateway UI, or by a future richer push).
 */
export interface AgentCatalogManifestAgent {
  name: string;
  display_name?: string;
  description?: string;
  /** Default LLM for this agent (full model id or shortcut). */
  default_model?: string;
  prompts?: AgentCatalogManifestPrompt[];
  tools?: AgentCatalogManifestTool[];
  skills?: AgentCatalogManifestSkill[];
}

/** POST /_plugin/agents request body (whole-fleet, replace-by-source). */
export interface AgentCatalogManifest {
  source: string;
  agents: AgentCatalogManifestAgent[];
}

/** POST /_plugin/agents response body — counts of nodes written. */
export interface SeedAgentsResponse {
  written: {
    agents: number;
    prompts: number;
    tools: number;
    skills: number;
  };
}
