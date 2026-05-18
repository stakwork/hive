import { isBifrostEnabledForWorkspace } from "@/config/env";
import { logger } from "@/lib/logger";

import { reconcileBifrostVK } from "./reconciler";
import { ensureBifrostTrust } from "./trust-reconciler";

// Inlined to keep this file out of the `@/lib/ai/*` dependency tree
// (which transitively pulls in `services/workspace` and ioredis).
// Must stay in sync with `PUBLIC_VIEWER_USER_ID` in
// `src/lib/ai/workspaceConfig.ts`.
const PUBLIC_VIEWER_USER_ID = "__public_viewer__";

/**
 * Master Bifrost reconciler — the **only** function callers should
 * invoke to get Bifrost credentials for an LLM call.
 *
 * Chains the three lazy reconcilers in their dependency order and
 * returns a single result shape suited to LLM-SDK call sites
 * (`{ apiKey, baseUrl }`) or `undefined` when Bifrost shouldn't be
 * used for this call.
 *
 * ```
 * getBifrostForLLM(auth, model)
 *   ├── feature flag / public-viewer / missing-auth guards
 *   ├── ensureBifrostTrust(workspaceId)
 *   │     └── ensureMacaroonOrgKeys(orgId)   ← autogen if missing
 *   └── reconcileBifrostVK(workspaceId, userId)
 * ```
 *
 * Layering rule: nothing in `lib/ai/` (or any other LLM-caller
 * module) should call `ensureBifrostTrust` / `reconcileBifrostVK` /
 * `ensureMacaroonOrgKeys` directly. They're internal building
 * blocks of this orchestrator. The orchestrator is the contract.
 *
 * Failure posture (per `gateway/plans/phases/phase-5-trust-registry.md`):
 *   - Feature flag off / public viewer / no workspace+user → `undefined`.
 *     Caller falls back to the swarm's default LLM key.
 *   - Trust reconcile fails → logged, swallowed; VK reconcile still
 *     runs. Macaroon enforcement is off through phase 5, so a
 *     transient trust hiccup doesn't break LLM calls.
 *   - VK reconcile fails → logged; returns `undefined`. Caller falls
 *     back to the swarm's default LLM key.
 *
 * @param workspaceAuth Workspace + user context. `workspaceSlug` is
 *   used for the rollout flag; `workspaceId` + `userId` identify
 *   the principal whose Bifrost VK should be returned.
 * @param model Optional model shortcut (`"sonnet"`, `"opus"`, `"gpt"`,
 *   `"gemini"`, `"kimi"`), namespaced model id, or full provider
 *   model id. Determines which provider suffix the returned
 *   `baseUrl` carries. Defaults to anthropic when omitted.
 */
export async function getBifrostForLLM(
  workspaceAuth?: WorkspaceAuth,
  model?: string,
): Promise<BifrostLLMCredentials | undefined> {
  // 1. Gates — short-circuit before any DB or HTTP work.
  if (!isBifrostEnabledForWorkspace(workspaceAuth?.workspaceSlug)) {
    return undefined;
  }
  if (!workspaceAuth?.workspaceId || !workspaceAuth?.userId) return undefined;
  // Public viewers have no real user identity — no per-user VK.
  if (workspaceAuth.userId === PUBLIC_VIEWER_USER_ID) return undefined;

  // 2. Trust reconcile (phase 5). Includes per-org macaroon-key
  // autogen as its first step. Non-fatal: failures are logged inside
  // `ensureBifrostTrust` and we fall through to VK reconcile.
  await runTrustReconcile(workspaceAuth.workspaceId);

  // 3. VK reconcile (phase 1). The result shape is what every LLM
  // caller actually wants.
  return runVKReconcile(workspaceAuth, model);
}

async function runTrustReconcile(workspaceId: string): Promise<void> {
  try {
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

async function runVKReconcile(
  workspaceAuth: Required<Pick<WorkspaceAuth, "workspaceId" | "userId">>,
  model: string | undefined,
): Promise<BifrostLLMCredentials | undefined> {
  try {
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
 * What an LLM-SDK caller wants: a bearer token to send as
 * `Authorization: Bearer <apiKey>` (or the SDK's equivalent) and a
 * provider-suffixed base URL to hit. Both come from the VK
 * reconciler; the trust reconcile happens as a side-effect of
 * getting here.
 */
export interface BifrostLLMCredentials {
  apiKey: string;
  baseUrl: string;
}
