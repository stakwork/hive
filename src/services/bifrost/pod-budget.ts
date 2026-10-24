import { isPodMothershipBudgetEnabled } from "@/config/env";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

import type { BifrostAgentName } from "./agent-names";

/**
 * Pod budget through Mothership/Bifrost — everything behind
 * `POD_MOTHERSHIP_BUDGET_ENABLED` (see `isPodMothershipBudgetEnabled`).
 * With the flag off nothing in here is called and pod behavior is
 * unchanged.
 *
 * What it does when on:
 *   - At pod claim (and again at agent-session start, which re-derives the
 *     same run id) mint a short-lived, dollar-capped permission with the
 *     EXISTING mechanism (trust reconcile + catalog seed + VK reconcile +
 *     `mintInvocationMacaroon`), charged to the user who triggered the job.
 *     That user's existing Mothership total is the other limit; this adds
 *     no per-person total.
 *   - Hand the pod the VK + gateway baseUrl + `x-macaroon` header, never a
 *     provider key. If no gateway credential can be obtained the claim /
 *     agent start FAILS; there is no direct-key fallback.
 *   - Before handing a key, require the gateway to report that it enforces
 *     macaroons and budgets and has a healthy Redis; fail CLOSED otherwise.
 *   - On pod release, revoke the permission (best-effort, never blocks the
 *     release). VKs never expire, so the time limit lives on the macaroon.
 *
 * No schema change: the permission's run id is derived from the claim,
 * `pod-claim:<podId>:<claim time ms>`. `Pod.usageStatusMarkedAt` is the
 * claim time (set by `claimAvailablePod`, cleared by `releasePodById`), so
 * release can recompute the run id with no extra column.
 *
 * Claude Code in the pod: hive has no channel to set env
 * (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_CUSTOM_HEADERS) in
 * a pod. The only per-claim request shapes are the `/session` body
 * (`apiKey`/`baseUrl`/`headers`/`searchApiKey`, read by the goose agent)
 * and `/validate_frontend`; hive also contains no code that starts Claude
 * Code. So Claude Code is NOT routed through the gateway by this change,
 * and hive never hands it a key: everything above is the goose/workflow
 * path only. (Pool-level env on the swarm is static, not per claim.)
 */

/** Default dollar ceiling for one pod job (per claim). */
export const POD_BUDGET_DEFAULT_MAX_COST_USD = 10;

/** Lifetime of a per-claim permission. Revoked earlier on release. */
export const POD_BUDGET_TTL_SECONDS = 4 * 60 * 60;

const LOG_TAG = "POD_BUDGET";

/** Who triggered the job: the user the spend is charged to. */
export interface PodBudgetPrincipal {
  workspaceId: string;
  workspaceSlug: string;
  userId?: string | null;
}

export interface PodGatewayCredential {
  apiKey: string;
  baseUrl: string;
  headers: Record<string, string>;
  runId: string;
}

export class PodBudgetError extends Error {
  constructor(message: string) {
    super("Pod budget (Mothership): " + message);
    this.name = "PodBudgetError";
  }
}

/** Macaroon run id for one pod claim, derived (not stored). */
export function podClaimRunId(podId: string, claimedAt: Date): string {
  return "pod-claim:" + podId + ":" + claimedAt.getTime();
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function loadPluginClient(workspaceId: string) {
  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: { swarmUrl: true, swarmApiKey: true },
  });
  if (!swarm?.swarmUrl || !swarm.swarmApiKey) {
    throw new PodBudgetError("workspace has no swarm gateway configured");
  }
  const [{ EncryptionService }, { BifrostPluginClient }, { deriveBifrostBaseUrl }] =
    await Promise.all([
      import("@/lib/encryption"),
      import("./BifrostPluginClient"),
      import("./resolve"),
    ]);
  return new BifrostPluginClient({
    baseUrl: deriveBifrostBaseUrl(swarm.swarmUrl),
    provisioningToken: EncryptionService.getInstance().decryptField("swarmApiKey", swarm.swarmApiKey),
  });
}

/** Fail CLOSED unless the gateway says it enforces macaroons + budgets with a healthy Redis. */
async function assertGatewayEnforcing(workspaceId: string): Promise<void> {
  let status;
  try {
    const client = await loadPluginClient(workspaceId);
    status = await client.getEnforcementStatus();
  } catch (err) {
    if (err instanceof PodBudgetError) throw err;
    throw new PodBudgetError("could not verify gateway enforcement (" + errMsg(err) + ")");
  }
  if (
    status?.macaroon_enforcement !== true ||
    status?.budget_enforcement !== true ||
    status?.redis_healthy !== true
  ) {
    throw new PodBudgetError(
      "gateway is not enforcing (macaroon enforcement, budget enforcement and a healthy Redis are all required)",
    );
  }
}

async function mintGatewayCredential(
  principal: PodBudgetPrincipal,
  opts: { agentName: BifrostAgentName; runId: string; model?: string },
): Promise<PodGatewayCredential> {
  const { workspaceId, userId } = principal;
  if (!userId) {
    throw new PodBudgetError("no user to charge for this pod job");
  }

  await assertGatewayEnforcing(workspaceId);

  // Trust + catalog are best-effort, as in the orchestrator: the VK and
  // mint below are what must succeed, and enforcement rejects a macaroon
  // the gateway cannot verify.
  try {
    const { ensureBifrostTrust } = await import("./trust-reconciler");
    await ensureBifrostTrust(workspaceId);
  } catch (err) {
    logger.warn("Pod budget trust reconcile threw; continuing", LOG_TAG, { workspaceId, error: errMsg(err) });
  }
  try {
    const { ensureBifrostAgentCatalog } = await import("./agent-catalog-reconciler");
    await ensureBifrostAgentCatalog(workspaceId, userId);
  } catch (err) {
    logger.warn("Pod budget agent catalog seed threw; continuing", LOG_TAG, { workspaceId, error: errMsg(err) });
  }

  try {
    const { reconcileBifrostVK } = await import("./reconciler");
    const vk = await reconcileBifrostVK(workspaceId, userId, { model: opts.model });
    if (vk.modelProviderGranted === false) {
      throw new PodBudgetError("virtual key has no grant for the model's provider");
    }
    const { mintInvocationMacaroon } = await import("./macaroon-issuer");
    const minted = await mintInvocationMacaroon({
      workspaceId,
      userId,
      agentName: opts.agentName,
      runId: opts.runId,
      maxCostUsd: POD_BUDGET_DEFAULT_MAX_COST_USD,
      ttlSeconds: POD_BUDGET_TTL_SECONDS,
    });
    return {
      apiKey: vk.vkValue,
      baseUrl: vk.baseUrl,
      headers: { "x-macaroon": minted.token },
      runId: minted.runId,
    };
  } catch (err) {
    if (err instanceof PodBudgetError) throw err;
    throw new PodBudgetError("could not obtain a gateway credential (" + errMsg(err) + ")");
  }
}

/**
 * Gateway credential for a claimed pod (agent `pod-agent`), run id derived
 * from the claim. Called at claim and at each agent-session start; the same
 * run id means the same $ budget, not a new one. Throws `PodBudgetError`
 * rather than ever returning nothing.
 */
export async function acquirePodGatewayCredential(
  principal: PodBudgetPrincipal,
  podId: string,
  opts: { model?: string } = {},
): Promise<PodGatewayCredential> {
  const pod = await db.pod.findFirst({
    where: { podId, deletedAt: null },
    select: { usageStatusMarkedAt: true },
  });
  if (!pod?.usageStatusMarkedAt) {
    throw new PodBudgetError("pod " + podId + " has no active claim");
  }
  return mintGatewayCredential(principal, {
    agentName: "pod-agent",
    runId: podClaimRunId(podId, pod.usageStatusMarkedAt),
    model: opts.model,
  });
}

/**
 * Gateway credential for the pod repair cron / validation (agent
 * `pod-repair-agent`), charged to `principal.userId` (the workspace owner
 * for the cron). Not tied to a claim, so it is bounded by the $ cap and
 * `POD_BUDGET_TTL_SECONDS` only; there is no release to revoke it on.
 */
export async function acquirePodRepairGatewayCredential(
  principal: PodBudgetPrincipal,
  runId: string,
): Promise<PodGatewayCredential> {
  return mintGatewayCredential(principal, {
    agentName: "pod-repair-agent",
    runId: "pod-repair:" + runId,
  });
}

/**
 * Revoke the permission of the claim being released. Best-effort: never
 * throws, logs and continues. No-op when the flag is off for the pod's
 * workspace. Needs the gateway's `POST /_plugin/revocations` (see
 * `BifrostPluginClient.revokeRun`), which the gateway job must supply; until
 * then this logs a warning and the macaroon's 4h TTL is the backstop.
 */
export async function revokePodClaimPermission(
  swarmId: string,
  podId: string,
  claimedAt: Date | null | undefined,
): Promise<void> {
  try {
    if (!claimedAt) return;
    const swarm = await db.swarm.findUnique({
      where: { id: swarmId },
      select: { workspaceId: true, workspace: { select: { slug: true } } },
    });
    if (!swarm || !isPodMothershipBudgetEnabled(swarm.workspace?.slug)) return;
    const client = await loadPluginClient(swarm.workspaceId);
    await client.revokeRun(podClaimRunId(podId, claimedAt));
  } catch (err) {
    logger.warn("Pod budget revoke failed; release continues", LOG_TAG, { podId, error: errMsg(err) });
  }
}
