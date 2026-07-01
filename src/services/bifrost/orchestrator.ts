import {
  isBifrostEnabledForAgent,
  isBifrostEnabledForWorkspace,
} from "@/config/env";
import { logger } from "@/lib/logger";

import {
  MACAROON_DEFAULT_MAX_COST_USD,
  MACAROON_DEFAULT_MAX_STEPS,
  MACAROON_DEFAULT_TTL_SECONDS,
  MACAROON_ISSUER_LOG_TAG,
} from "./constants";

// NOTE: the three layer modules below — `macaroon-issuer`,
// `reconciler`, `trust-reconciler` — are loaded LAZILY (dynamic
// `await import()` inside the run* helpers) rather than as static
// imports.
//
// Why: each layer transitively pulls in heavy deps (secp256k1,
// gatekey, BifrostClient + ioredis lock, aieo, EncryptionService).
// When the rollout flag is off — which is the default in test
// workers and dev — none of those modules need to be in memory.
// Static imports here would load all of them at every test file
// that transitively touches an LLM call site, and the integration
// suite runs single-threaded with cumulative module retention
// across 250+ files; we hit ERR_WORKER_OUT_OF_MEMORY in CI.
//
// Prod cost is negligible: Node module cache makes the second+
// dynamic import a sub-microsecond Map lookup. The first call after
// boot pays a one-time ~10ms parse cost, invisible against any
// real LLM round-trip.

// Inlined to keep this file out of the `@/lib/ai/*` dependency tree
// (which transitively pulls in `services/workspace` and ioredis).
// Must stay in sync with `PUBLIC_VIEWER_USER_ID` in
// `src/lib/ai/workspaceConfig.ts`.
const PUBLIC_VIEWER_USER_ID = "__public_viewer__";

/**
 * The exhaustive registry of `agentName` values any LLM call site in
 * Hive may emit. The `agent-name` dim on `logs.db` is only useful if
 * it's drawn from a finite, well-known set — so every new call site
 * MUST add itself here, and `opts.agentName` on
 * {@link getBifrostForLLM} is typed against this union to catch
 * unregistered values at compile time.
 *
 * Grouping:
 *   - chat surfaces (in-process, PR #4078):
 *     `repo-agent`, `chat-agent`, `canvas-agent`, `diagram-agent`,
 *     `logs-agent`
 *   - workflow / agent-session surfaces (PR #4079):
 *     `plan-agent`, `coding-agent`, `pr-monitor`, `task-generation`
 *
 * The `coding-agent` entry intentionally covers BOTH the Stakwork
 * task workflow (live/unit/integration/default) and the hive4 goose
 * direct agent session — they share the dim because the underlying
 * work is the same "code-writing agent" shape. The
 * `BIFROST_ENABLED_AGENTS` env var filters on these literal values,
 * so listing `coding-agent` opts BOTH surfaces in (or neither).
 *
 * `task-generation` is the structured-JSON ticket generator
 * dispatched by `createStakworkRun` for `StakworkRunType.TASK_GENERATION`
 * — a sibling to `plan-agent` on the AI-generation workflow. Per-agent
 * dim lets us see TASK_GENERATION cost separately from the other run
 * types that share `STAKWORK_AI_GENERATION_WORKFLOW_ID`. Note the bare
 * name (no `-agent` suffix) is intentional — it matches the
 * `StakworkRunType.TASK_GENERATION` enum value rather than the
 * Bifrost `{name}-agent` convention used elsewhere in this list.
 */
export const BIFROST_AGENT_NAMES = [
  // Chat surfaces (PR #4078)
  "repo-agent",
  "chat-agent",
  "canvas-agent",
  "diagram-agent",
  "logs-agent",
  // Workflow / agent-session surfaces (PR #4079)
  "plan-agent",
  "coding-agent",
  "test-agent",
  "build-agent",
  "browser-agent",
] as const;

export type BifrostAgentName = (typeof BIFROST_AGENT_NAMES)[number];

/**
 * Master Bifrost reconciler — the **only** function callers should
 * invoke to get Bifrost credentials for an LLM call.
 *
 * Chains the lazy reconcilers in their dependency order and returns
 * a single result shape suited to LLM-SDK call sites
 * (`{ apiKey, baseUrl, headers, runId, agentName }`) or `undefined`
 * when Bifrost shouldn't be used for this call.
 *
 * ```
 * getBifrostForLLM(auth, { agentName, ... })
 *   ├── feature flag / public-viewer / missing-auth guards
 *   ├── ensureBifrostTrust(workspaceId)
 *   │     └── ensureMacaroonOrgKeys(orgId)        ← autogen if missing
 *   ├── reconcileBifrostVK(workspaceId, userId)
 *   └── mintInvocationMacaroon(...)              ← x-macaroon header
 *         ├── ensureMacaroonOrgKeys (fast-path cache hit after trust)
 *         └── ensureMacaroonUserKeys (autogen if missing)
 * ```
 *
 * Layering rule: nothing in `lib/ai/` (or any other LLM-caller
 * module) should call `ensureBifrostTrust` / `reconcileBifrostVK` /
 * `mintInvocationMacaroon` directly. They're internal building
 * blocks of this orchestrator. The orchestrator is the contract.
 *
 * Failure posture (per `gateway/plans/phases/phase-5-trust-registry.md`
 * and `phase-6-plugin-enforcement.md` "Failure modes"):
 *   - Feature flag off / public viewer / no workspace+user → `undefined`.
 *     Caller falls back to the swarm's default LLM key.
 *   - Trust reconcile fails → logged, swallowed; VK + mint still run.
 *     Macaroon enforcement is off through phase 5/6 shadow mode, so a
 *     transient trust hiccup doesn't break LLM calls.
 *   - VK reconcile fails → logged; returns `undefined`. Caller falls
 *     back to the swarm's default LLM key.
 *   - Macaroon mint fails → logged; returns the VK shape with an
 *     empty `headers` map. The LLM call still proceeds (shadow mode);
 *     the only loss is this one call's worth of `agent-name` dim on
 *     `logs.db`. NEVER let a mint failure break an otherwise-healthy
 *     LLM call.
 *
 * @param workspaceAuth Workspace + user context. `workspaceSlug` is
 *   used for the rollout flag; `workspaceId` + `userId` identify
 *   the principal whose Bifrost VK should be returned.
 * @param opts Required `agentName` (drives the `agent-name` dim that
 *   ends up in `logs.db`) plus optional model + per-invocation
 *   budget / lifetime overrides. The contract here is intentionally
 *   strict on `agentName` — without it, the cost-per-agent
 *   observability this whole stack exists to provide is silently
 *   lost. Forcing every call site to name itself catches new sites
 *   at type-check time.
 */
export async function getBifrostForLLM(
  workspaceAuth: WorkspaceAuth | undefined,
  opts: GetBifrostForLLMOptions,
): Promise<BifrostInvocation | undefined> {
  // 1. Gates — short-circuit before any DB or HTTP work.
  //
  // Two independent rollout gates are ANDed here:
  //   a. Workspace gate (`BIFROST_ENABLED`): default-closed allow-list
  //      of workspace slugs that should route through Bifrost at all.
  //   b. Agent gate (`BIFROST_ENABLED_AGENTS`): default-open allow-list
  //      of `agentName` values. Lets operators roll Bifrost out per
  //      surface (e.g. workflow agents only) without enabling every
  //      LLM call in an enrolled workspace.
  //
  // Either gate failing → `undefined` → caller falls back to the
  // swarm's pre-Bifrost default key (byte-for-byte unchanged path).
  if (!isBifrostEnabledForWorkspace(workspaceAuth?.workspaceSlug)) {
    return undefined;
  }
  if (!isBifrostEnabledForAgent(opts?.agentName)) {
    return undefined;
  }
  if (!workspaceAuth?.workspaceId || !workspaceAuth?.userId) return undefined;
  // Public viewers have no real user identity — no per-user VK, no
  // per-user macaroon key, no mint.
  if (workspaceAuth.userId === PUBLIC_VIEWER_USER_ID) return undefined;
  if (!opts?.agentName) {
    // Defensive: TypeScript blocks this path at compile time, but
    // catching it at runtime too means a future `any`-typed caller
    // can't silently break dim observability without a log line.
    logger.warn(
      "getBifrostForLLM called without agentName; falling back",
      "BIFROST_ORCHESTRATOR",
      { workspaceId: workspaceAuth.workspaceId },
    );
    return undefined;
  }

  // 2. Trust reconcile (phase 5). Includes per-org macaroon-key
  // autogen as its first step. Non-fatal: failures are logged inside
  // `ensureBifrostTrust` and we fall through to VK reconcile.
  await runTrustReconcile(workspaceAuth.workspaceId);

  // 2b. Agent-catalog seed. Pushes the default agent set into the
  // swarm's gateway neo4j catalog. Content-addressed-cached on the
  // Swarm row, so this is a single DB read on the hot path. Non-fatal
  // and independent of trust — a stale/absent catalog never blocks an
  // LLM call. See `gateway/plans/agent-catalog.md`.
  await runAgentCatalogReconcile(workspaceAuth.workspaceId);

  // 3. VK reconcile (phase 1). Without this, the LLM call can't
  // route through Bifrost at all — return undefined and let the
  // caller fall back to the swarm-default key.
  const vk = await runVKReconcile(workspaceAuth, opts.model);
  if (!vk) return undefined;

  // 4. Mint a macaroon for the x-macaroon header (phase 4 shadow
  // mode). Failure here MUST NOT block the LLM call — we return the
  // VK shape with empty headers and the call proceeds without the
  // dim. See "Failure posture" in this function's doc.
  const headers = await runMint(workspaceAuth, opts);

  return {
    apiKey: vk.apiKey,
    baseUrl: vk.baseUrl,
    headers: headers.map,
    runId: headers.runId,
    agentName: opts.agentName,
  };
}

async function runTrustReconcile(workspaceId: string): Promise<void> {
  try {
    const { ensureBifrostTrust } = await import("./trust-reconciler");
    const result = await ensureBifrostTrust(workspaceId);
    if (result.status === "failed") {
      // Already logged by ensureBifrostTrust at warn level; we
      // deliberately continue so a transient plugin issue doesn't
      // block LLM calls.
      return;
    }
  } catch (err) {
    // Defensive — ensureBifrostTrust catches its own errors and
    // returns `failed`; this is for unexpected throws (lock-acquire
    // timeout, DB connection drop, etc.).
    logger.warn(
      "Bifrost trust reconcile threw unexpectedly; continuing to VK reconcile",
      "BIFROST_TRUST",
      {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }
}

async function runAgentCatalogReconcile(workspaceId: string): Promise<void> {
  try {
    const { ensureBifrostAgentCatalog } = await import(
      "./agent-catalog-reconciler"
    );
    await ensureBifrostAgentCatalog(workspaceId);
  } catch (err) {
    // Defensive — ensureBifrostAgentCatalog catches its own errors and
    // returns `failed`; this is for unexpected throws (lock-acquire
    // timeout, DB drop). Swallow so catalog seeding never blocks an
    // LLM call.
    logger.warn(
      "Bifrost agent catalog reconcile threw unexpectedly; continuing",
      "BIFROST_AGENTS",
      {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }
}

async function runVKReconcile(
  workspaceAuth: Required<Pick<WorkspaceAuth, "workspaceId" | "userId">>,
  model: string | undefined,
): Promise<{ apiKey: string; baseUrl: string } | undefined> {
  try {
    const { reconcileBifrostVK } = await import("./reconciler");
    const result = await reconcileBifrostVK(
      workspaceAuth.workspaceId,
      workspaceAuth.userId,
      { model },
    );
    return { apiKey: result.vkValue, baseUrl: result.baseUrl };
  } catch (err) {
    logger.warn(
      "Bifrost VK reconcile failed; falling back to default LLM key",
      "BIFROST_VK",
      {
        workspaceId: workspaceAuth.workspaceId,
        userId: workspaceAuth.userId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return undefined;
  }
}

/**
 * Mint the per-call macaroon and return the headers map to attach.
 * Non-throwing — on any failure, returns an empty map plus a fresh
 * runId for caller-side correlation, and logs the underlying reason
 * so operators can see mint health independently of LLM-call health.
 */
async function runMint(
  workspaceAuth: Required<Pick<WorkspaceAuth, "workspaceId" | "userId">>,
  opts: GetBifrostForLLMOptions,
): Promise<{ map: Record<string, string>; runId: string }> {
  try {
    const { mintInvocationMacaroon } = await import("./macaroon-issuer");
    const minted = await mintInvocationMacaroon({
      workspaceId: workspaceAuth.workspaceId,
      userId: workspaceAuth.userId,
      agentName: opts.agentName,
      runId: opts.runId,
      maxCostUsd: opts.maxCostUsd ?? MACAROON_DEFAULT_MAX_COST_USD,
      maxSteps: opts.maxSteps ?? MACAROON_DEFAULT_MAX_STEPS,
      ttlSeconds: opts.ttlSeconds ?? MACAROON_DEFAULT_TTL_SECONDS,
    });
    return {
      map: { "x-macaroon": minted.token },
      runId: minted.runId,
    };
  } catch (err) {
    logger.warn(
      "Macaroon mint failed; proceeding without x-macaroon header",
      MACAROON_ISSUER_LOG_TAG,
      {
        workspaceId: workspaceAuth.workspaceId,
        userId: workspaceAuth.userId,
        agentName: opts.agentName,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    // Caller-supplied runId still wins so correlation works even on
    // mint failure; otherwise emit a placeholder. We deliberately do
    // NOT generate a fresh UUID here so the caller can detect mint
    // failure via `result.runId === opts.runId ?? ""`.
    return { map: {}, runId: opts.runId ?? "" };
  }
}

/**
 * Caller context. Mirrors `WorkspaceAuth` from `lib/mcp/mcpTools.ts`
 * — duplicated here to keep `services/bifrost/` from depending on
 * the MCP layer. Re-imported from MCP at call sites; the shape is
 * intentionally identical.
 */
export interface WorkspaceAuth {
  workspaceId: string;
  workspaceSlug: string;
  userId: string;
}

/**
 * What an LLM caller needs.
 *
 *   - `apiKey` / `baseUrl`: bearer token + per-provider base URL.
 *     Routes the call through this workspace's Bifrost VK.
 *   - `headers`: extra HTTP headers to attach. Today this carries
 *     the minted `x-macaroon` for cost-per-agent observability;
 *     future additions (extra `x-bf-dim-*` headers, correlation
 *     headers, etc.) accumulate here without further call-site
 *     changes. Empty when the mint failed.
 *   - `runId`: the macaroon's run id (auto-generated if the caller
 *     didn't supply one). Use it for correlation across logs.
 *   - `agentName`: echoed back for symmetry with `runId`.
 *
 * Naming note: this is "what a single LLM invocation needs," not
 * "credentials," so `BifrostInvocation` reads better than the old
 * `BifrostLLMCredentials`. The old name is re-exported below for a
 * transitional period — delete it once consumers have migrated.
 */
export interface BifrostInvocation {
  apiKey: string;
  baseUrl: string;
  headers: Record<string, string>;
  runId: string;
  agentName: BifrostAgentName;
}

/**
 * Backward-compatible alias of `BifrostInvocation`. New callers
 * should prefer the new name; the alias exists so a downstream
 * import of `BifrostLLMCredentials` keeps compiling.
 */
export type BifrostLLMCredentials = BifrostInvocation;

export interface GetBifrostForLLMOptions {
  /**
   * The agent name that drives the `agent-name` dim that ends up on
   * `logs.db`. Required — see this function's doc for rationale.
   * Typed against {@link BIFROST_AGENT_NAMES} so adding a new LLM
   * call site forces a registry update at compile time. The gateway
   * plugin canonicalizes this from the macaroon's
   * `effective_caveats.agents[-1]`.
   */
  agentName: BifrostAgentName;

  /**
   * Optional model shortcut (`"sonnet"`, `"opus"`, `"gpt"`,
   * `"gemini"`, `"kimi"`), namespaced model id, or full provider
   * model id. Determines which provider suffix the returned
   * `baseUrl` carries. Defaults to anthropic when omitted.
   */
  model?: string;

  /** Caller-supplied run id. Useful when correlating with an
   * external system (e.g. `StakworkRun.id`). Auto-generated UUID
   * when absent. */
  runId?: string;

  /** Override the per-invocation USD budget. Defaults to
   * {@link MACAROON_DEFAULT_MAX_COST_USD}. */
  maxCostUsd?: number;

  /** Override the per-invocation step ceiling. Defaults to
   * {@link MACAROON_DEFAULT_MAX_STEPS}. */
  maxSteps?: number;

  /** Override the macaroon TTL in seconds. Defaults to
   * {@link MACAROON_DEFAULT_TTL_SECONDS}. */
  ttlSeconds?: number;
}
