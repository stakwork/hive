// ─── The one entry point LLM callers should use ──────────────────────
//
// `getBifrostForLLM` is the master reconciler — it chains
// `ensureBifrostTrust` (phase 5) and `reconcileBifrostVK` (phase 1)
// in the correct order, applies the rollout/public-viewer gates,
// and returns the `{ apiKey, baseUrl }` shape every LLM-SDK caller
// wants. Nothing outside this package should reach past it to call
// the per-layer reconcilers directly.
export { getBifrostForLLM } from "./orchestrator";
export type {
  BifrostLLMCredentials,
  WorkspaceAuth,
} from "./orchestrator";

// ─── Per-layer building blocks (exported for testing + advanced use) ─
//
// New code in `lib/ai/`, `lib/mcp/`, etc. should NOT call these
// directly — go through `getBifrostForLLM` so the orchestration
// (failure posture, ordering, gates) stays in one place.
export { reconcileBifrostVK } from "./reconciler";
export { BifrostClient, BifrostHttpError } from "./BifrostClient";
export { BifrostPluginClient } from "./BifrostPluginClient";
export { deriveBifrostBaseUrl, resolveBifrost, BifrostConfigError } from "./resolve";
export { bootstrapAdminCreds } from "./bootstrap";
export {
  ensureMacaroonOrgKeys,
  MacaroonOrgKeysError,
} from "./macaroon-org-keys";
export type { MacaroonOrgKeys } from "./macaroon-org-keys";
export {
  ensureMacaroonUserKeys,
  MacaroonUserKeysError,
} from "./macaroon-user-keys";
export type { MacaroonUserKeys } from "./macaroon-user-keys";
export {
  mintInvocationMacaroon,
  MacaroonIssuerError,
} from "./macaroon-issuer";
export type {
  MintInvocationOptions,
  MintedMacaroon,
} from "./macaroon-issuer";
export { ensureBifrostTrust } from "./trust-reconciler";
export type {
  TrustReconcileResult,
  TrustReconcileStatus,
  TrustReconcileOptions,
} from "./trust-reconciler";
export type { BootstrapResult } from "./bootstrap";
export type {
  ReconcileResult,
  BifrostCustomer,
  BifrostVirtualKey,
  BifrostAdminCreds,
  BifrostProvider,
  TrustStatusResponse,
  TrustOrgUpsert,
  TrustUpsertResponse,
  TrustOrgRow,
} from "./types";
