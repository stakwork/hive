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
  /** Bifrost base URL that owns this VK (e.g. "https://swarm.example:8181"). */
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
