/**
 * Strut standing delegation — hive's half of
 * `strut/plans/mothership-cost-control.md` (§4).
 *
 * Strut's LLM calls are billed to a PERSON, a WORKFLOW and a STEP through
 * the Agent Mothership (the swarm's Bifrost gateway). Hive is the only
 * signer: once per user and swarm it mints a long-lived macaroon — the
 * org-signed user authorization plus a user-signed *standing invocation*
 * for the agent `strut-agent`, with `max_steps: 0` (no call-count cap: any
 * positive number would be wider than what strut can narrow under) and a
 * cumulative USD ceiling — and pushes it to the workspace swarm's strut lab
 * together with that user's Bifrost virtual key and the gateway root:
 *
 *     PUT {mcp}/lab/llm/delegations/{actor}  { macaroon, apiKey, baseUrl }
 *
 * Strut only attenuates: it appends keyless HMAC links per run and per
 * step, and the gateway bills the last agent name (the step). Strut holds
 * no signing key and never calls hive back.
 *
 * **The actor.** The `:actor` in the URL, the `x-strut-actor` header on
 * hive's server-side lab calls and the `sub` of the embed JWT MUST all be
 * the macaroon's `user_id` — `buildBifrostName(userId, login)` — so strut's
 * spend lands on the same user as everything else hive routes through the
 * gateway. Every hive caller holds the raw `User.id`, which is NOT that
 * string; use `resolveStrutActor`.
 *
 * **Reaching the lab.** Hive talks to strut through the swarm's stakgraph
 * mcp, which mounts strut at `/lab` behind its own gate (`x-api-token` =
 * the swarm API key) and bridges the raw request — headers included —
 * into strut. The delegation routes sit behind strut's `requireApiKey`
 * (`Authorization: Bearer <STRUT_API_KEY>`, permissive only while the lab
 * has no key configured), so every call here carries BOTH headers with the
 * swarm API key. That pins the mcp-side contract: the lab strut's
 * `STRUT_API_KEY`, when mcp sets one, must be `API_TOKEN` (the same
 * `??= API_TOKEN` the plan prescribes for `STRUT_SECRET_KEY`, §5) — hive
 * has no other secret for that swarm.
 *
 * **Gates and failure posture.** The push runs behind the same gates as
 * `getBifrostForLLM` (`BIFROST_ENABLED` per workspace, the per-agent gate,
 * a real workspace + user, not the public viewer) and calls the same
 * building blocks first — trust register, catalog seed, `reconcileBifrostVK`
 * (which throws for a user with no `WorkspaceMember` row: owners only get
 * one lazily via `/access`). `ensureStrutDelegation` NEVER throws: a failed
 * push is logged and the embed / dispatch goes ahead — strut then calls
 * the provider directly for that user, exactly as before this existed.
 *
 * The `strut-delegations` cron (`services/strut-delegations-cron.ts`) keeps
 * every pushed delegation alive (re-mint inside the last 15 days) and
 * removes the ones of members who left; the two `WorkspaceMember` columns
 * `strutDelegationExp` / `strutDelegationId` are its desired state. The
 * token itself is never stored hive-side.
 */

import { isBifrostEnabledForAgent, isBifrostEnabledForWorkspace } from "@/config/env";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";

import type { BifrostAgentName } from "./agent-names";
import {
  STRUT_DELEGATION_DEFAULT_MAX_COST_USD,
  STRUT_DELEGATION_HTTP_TIMEOUT_MS,
  STRUT_DELEGATION_LOG_TAG,
  STRUT_DELEGATION_TTL_SECONDS,
} from "./constants";
import type { WorkspaceAuth } from "./orchestrator";

// Must stay in sync with `PUBLIC_VIEWER_USER_ID` in
// `src/lib/ai/workspaceConfig.ts` (inlined for the same reason the
// orchestrator inlines it: keep this module out of the `lib/ai` tree).
const PUBLIC_VIEWER_USER_ID = "__public_viewer__";

/** The one agent name the standing invocation authorizes. */
export const STRUT_DELEGATION_AGENT = "strut-agent" satisfies BifrostAgentName;

/** Header naming the actor on hive's server-side calls into the lab. */
export const STRUT_ACTOR_HEADER = "x-strut-actor";

/** What `GET /llm/delegations` lists — and all strut ever reveals. */
export interface StrutDelegationSummary {
  actor: string;
  /** RFC 3339 UTC; the earlier of the UA's and the invocation's expiry. */
  exp: string;
  /** The standing invocation's `run_id`. */
  delegationId: string;
}

/** Where a workspace's strut lab is and how to authenticate to it. */
export interface StrutLabTarget {
  /** `{mcp}/lab` — the strut mount on the swarm's stakgraph mcp. */
  labBase: string;
  /** The swarm API key (decrypted). */
  swarmApiKey: string;
}

/** Thrown when the lab answers 404 for `/llm/delegations`: an mcp that
 *  does not mount the Mothership module yet. Not an error to retry. */
export class StrutDelegationsUnsupportedError extends Error {
  constructor(labBase: string) {
    super(`${labBase} has no /llm/delegations route (Mothership module not mounted)`);
    this.name = "StrutDelegationsUnsupportedError";
  }
}

export class StrutLabHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "StrutLabHttpError";
  }
}

/**
 * The delegation ceiling — `STRUT_DELEGATION_MAX_COST_USD` when it is a
 * positive number, else the default. Read at call time so a deployment
 * can lower it on a test workspace and re-push without a restart.
 */
export function strutDelegationMaxCostUsd(): number {
  const raw = process.env.STRUT_DELEGATION_MAX_COST_USD;
  if (raw === undefined || raw.trim() === "") {
    return STRUT_DELEGATION_DEFAULT_MAX_COST_USD;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    logger.warn("STRUT_DELEGATION_MAX_COST_USD is not a positive number; using the default", STRUT_DELEGATION_LOG_TAG, {
      raw,
      default: STRUT_DELEGATION_DEFAULT_MAX_COST_USD,
    });
    return STRUT_DELEGATION_DEFAULT_MAX_COST_USD;
  }
  return n;
}

/** `{mcp}/lab` for a stored swarm URL. */
export function strutLabBaseUrl(swarmUrl: string): string {
  return `${transformSwarmUrlToRepo2Graph(swarmUrl)}/lab`;
}

/**
 * The actor string for a user: `buildBifrostName(userId, githubLogin)`,
 * the same value the macaroon carries as `user_id`. One indexed read.
 */
export async function resolveStrutActor(userId: string): Promise<string> {
  const [{ buildBifrostName }, user] = await Promise.all([
    import("./reconciler"),
    db.user.findUnique({
      where: { id: userId },
      select: { githubAuth: { select: { githubUsername: true } } },
    }),
  ]);
  return buildBifrostName(userId, user?.githubAuth?.githubUsername ?? null);
}

/**
 * Both credentials the delegation routes need: mcp's lab gate reads
 * `x-api-token`; strut's `requireApiKey` reads the bearer. See the module
 * doc for why they are the same value.
 */
function delegationHeaders(target: StrutLabTarget): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-token": target.swarmApiKey,
    Authorization: `Bearer ${target.swarmApiKey}`,
  };
}

async function labFetch(
  target: StrutLabTarget,
  method: "GET" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Response> {
  const res = await fetch(`${target.labBase}${path}`, {
    method,
    headers: delegationHeaders(target),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(STRUT_DELEGATION_HTTP_TIMEOUT_MS),
  });
  if (res.status === 404 && path === "/llm/delegations") {
    throw new StrutDelegationsUnsupportedError(target.labBase);
  }
  return res;
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return text.slice(0, 300);
}

/** `GET /llm/delegations` → what strut holds, actors + expiries only. */
export async function listStrutDelegations(target: StrutLabTarget): Promise<StrutDelegationSummary[]> {
  const res = await labFetch(target, "GET", "/llm/delegations");
  if (!res.ok) {
    throw new StrutLabHttpError(res.status, `GET /llm/delegations returned ${res.status}: ${await errorText(res)}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("GET /llm/delegations did not return a list");
  }
  return data.filter(
    (d): d is StrutDelegationSummary =>
      !!d &&
      typeof d === "object" &&
      typeof (d as StrutDelegationSummary).actor === "string" &&
      typeof (d as StrutDelegationSummary).exp === "string" &&
      typeof (d as StrutDelegationSummary).delegationId === "string",
  );
}

/** `PUT /llm/delegations/:actor`. Strut validates the macaroon's shape
 *  and answers 400 for the wrong kind of macaroon. */
export async function putStrutDelegation(
  target: StrutLabTarget,
  actor: string,
  body: { macaroon: string; apiKey: string; baseUrl: string },
): Promise<StrutDelegationSummary> {
  const res = await labFetch(target, "PUT", `/llm/delegations/${encodeURIComponent(actor)}`, body);
  if (!res.ok) {
    throw new StrutLabHttpError(
      res.status,
      `PUT /llm/delegations/${actor} returned ${res.status}: ${await errorText(res)}`,
    );
  }
  const data = (await res.json().catch(() => ({}))) as Partial<StrutDelegationSummary>;
  if (typeof data.exp !== "string" || typeof data.delegationId !== "string") {
    throw new Error(`PUT /llm/delegations/${actor} returned no exp / delegationId`);
  }
  return { actor: data.actor ?? actor, exp: data.exp, delegationId: data.delegationId };
}

/** `DELETE /llm/delegations/:actor`. `false` when strut had none. */
export async function deleteStrutDelegation(target: StrutLabTarget, actor: string): Promise<boolean> {
  const res = await labFetch(target, "DELETE", `/llm/delegations/${encodeURIComponent(actor)}`);
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new StrutLabHttpError(
      res.status,
      `DELETE /llm/delegations/${actor} returned ${res.status}: ${await errorText(res)}`,
    );
  }
  return true;
}

/**
 * Mint the standing invocation. One call into the existing issuer — no
 * new issuer code: `agents: ["strut-agent"]` on both layers, `max_steps`
 * 0 (the explicit 0 survives the issuer's destructuring default), the
 * ceiling, and the 60-day lifetime on the UA and the invocation alike.
 */
export async function mintStrutDelegation(opts: {
  workspaceId: string;
  userId: string;
}): Promise<{ token: string; actor: string; delegationId: string; exp: string }> {
  const { mintInvocationMacaroon } = await import("./macaroon-issuer");
  const minted = await mintInvocationMacaroon({
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    agentName: STRUT_DELEGATION_AGENT,
    maxCostUsd: strutDelegationMaxCostUsd(),
    maxSteps: 0,
    ttlSeconds: STRUT_DELEGATION_TTL_SECONDS,
  });
  return {
    token: minted.token,
    actor: minted.macaroonUserId,
    delegationId: minted.runId,
    exp: minted.expiresAt,
  };
}

/**
 * Record what strut now holds for this member — the cron's desired state.
 * `updateMany` so a missing row (an owner without one) is a no-op rather
 * than a throw; `reconcileBifrostVK` has already refused that case.
 */
async function recordDelegation(
  workspaceId: string,
  userId: string,
  d: Pick<StrutDelegationSummary, "exp" | "delegationId">,
): Promise<void> {
  await db.workspaceMember.updateMany({
    where: { workspaceId, userId },
    data: {
      strutDelegationExp: new Date(d.exp),
      strutDelegationId: d.delegationId,
    },
  });
}

/**
 * Mint and push one user's delegation, unconditionally. The building
 * blocks run in `getBifrostForLLM`'s order: trust register and catalog
 * seed (both cached on the Swarm row, both non-fatal), then the VK
 * reconcile (fatal — without a virtual key there is nothing to push),
 * then the mint and the PUT. Throws on failure; callers decide whether
 * that matters (`ensureStrutDelegation` swallows, the cron records).
 */
export async function pushStrutDelegation(opts: {
  workspaceId: string;
  userId: string;
  swarmUrl: string;
  target: StrutLabTarget;
}): Promise<StrutDelegationSummary> {
  const { workspaceId, userId, swarmUrl, target } = opts;

  try {
    const { ensureBifrostTrust } = await import("./trust-reconciler");
    await ensureBifrostTrust(workspaceId);
  } catch (err) {
    logger.warn("Bifrost trust reconcile threw before the strut push; continuing", STRUT_DELEGATION_LOG_TAG, {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    const { ensureBifrostAgentCatalog } = await import("./agent-catalog-reconciler");
    await ensureBifrostAgentCatalog(workspaceId, userId);
  } catch (err) {
    logger.warn("Bifrost agent catalog reconcile threw before the strut push; continuing", STRUT_DELEGATION_LOG_TAG, {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const [{ reconcileBifrostVK }, { deriveBifrostBaseUrl }] = await Promise.all([
    import("./reconciler"),
    import("./resolve"),
  ]);
  const vk = await reconcileBifrostVK(workspaceId, userId);
  const minted = await mintStrutDelegation({ workspaceId, userId });

  // The gateway ROOT, not the per-provider URL the VK reconciler returns:
  // strut hands the root to aieo, which appends each provider's path.
  const gatewayRoot = deriveBifrostBaseUrl(swarmUrl);

  const pushed = await putStrutDelegation(target, minted.actor, {
    macaroon: minted.token,
    apiKey: vk.vkValue,
    baseUrl: gatewayRoot,
  });
  await recordDelegation(workspaceId, userId, pushed);

  logger.info("Pushed strut delegation", STRUT_DELEGATION_LOG_TAG, {
    workspaceId,
    userId,
    actor: pushed.actor,
    delegationId: pushed.delegationId,
    exp: pushed.exp,
    ceilingUsd: strutDelegationMaxCostUsd(),
    // The macaroon and the VK are NOT logged — both are bearer credentials.
  });
  return pushed;
}

export type EnsureStrutDelegationStatus =
  /** A rollout gate is closed, or no real workspace + user. */
  | "skipped-gate"
  /** Strut already holds one with more than half its life left. */
  | "fresh"
  /** Minted and pushed (first time, or a renewal). */
  | "pushed"
  /** The lab has no `/llm/delegations` route (older mcp). */
  | "unsupported"
  /** Attempted and failed; logged. The caller proceeds regardless. */
  | "failed";

export interface EnsureStrutDelegationResult {
  status: EnsureStrutDelegationStatus;
  actor?: string;
}

/**
 * Make sure the workspace swarm's strut holds a live delegation for this
 * user. Called from the moments hive already talks to strut with the user
 * present or attributed (the embed URL, a chat dispatch, a benchmark run):
 * one `GET /llm/delegations`; nothing more unless the stored delegation
 * is missing or past half its life. Never throws.
 */
export async function ensureStrutDelegation(
  workspaceAuth: WorkspaceAuth | undefined,
  swarm: { swarmUrl: string; swarmApiKey: string },
  opts: { actor?: string; now?: Date } = {},
): Promise<EnsureStrutDelegationResult> {
  if (!isBifrostEnabledForWorkspace(workspaceAuth?.workspaceSlug)) {
    return { status: "skipped-gate" };
  }
  if (!isBifrostEnabledForAgent(STRUT_DELEGATION_AGENT)) {
    return { status: "skipped-gate" };
  }
  if (!workspaceAuth?.workspaceId || !workspaceAuth?.userId) {
    return { status: "skipped-gate" };
  }
  if (workspaceAuth.userId === PUBLIC_VIEWER_USER_ID) {
    return { status: "skipped-gate" };
  }
  if (!swarm.swarmUrl || !swarm.swarmApiKey) return { status: "skipped-gate" };

  const { workspaceId, userId } = workspaceAuth;
  const target: StrutLabTarget = {
    labBase: strutLabBaseUrl(swarm.swarmUrl),
    swarmApiKey: swarm.swarmApiKey,
  };
  const now = opts.now ?? new Date();

  try {
    const actor = opts.actor ?? (await resolveStrutActor(userId));
    const listed = await listStrutDelegations(target);
    const current = listed.find((d) => d.actor === actor);

    if (current && !isPastHalfLife(current.exp, now)) {
      // Keep the desired-state columns in step with what strut holds —
      // a no-op write when they already are.
      await db.workspaceMember.updateMany({
        where: {
          workspaceId,
          userId,
          OR: [{ strutDelegationId: null }, { strutDelegationId: { not: current.delegationId } }],
        },
        data: {
          strutDelegationExp: new Date(current.exp),
          strutDelegationId: current.delegationId,
        },
      });
      return { status: "fresh", actor };
    }

    const pushed = await pushStrutDelegation({
      workspaceId,
      userId,
      swarmUrl: swarm.swarmUrl,
      target,
    });
    return { status: "pushed", actor: pushed.actor };
  } catch (err) {
    if (err instanceof StrutDelegationsUnsupportedError) {
      logger.info("Strut lab has no delegation routes; skipping the push", STRUT_DELEGATION_LOG_TAG, {
        workspaceId,
        userId,
        labBase: target.labBase,
      });
      return { status: "unsupported" };
    }
    logger.warn("Strut delegation push failed; proceeding without it", STRUT_DELEGATION_LOG_TAG, {
      workspaceId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "failed" };
  }
}

/**
 * A delegation is worth renewing on a visit once it is past half its
 * (60-day) life. Strut only reports `exp`, so "life left" is measured
 * against the fixed TTL. An unparseable `exp` counts as expired.
 */
export function isPastHalfLife(exp: string, now: Date = new Date()): boolean {
  const expMs = Date.parse(exp);
  if (!Number.isFinite(expMs)) return true;
  return expMs - now.getTime() <= (STRUT_DELEGATION_TTL_SECONDS * 1000) / 2;
}

/**
 * The cron's rule: renew when missing or within
 * `STRUT_DELEGATION_RENEW_WITHIN_MS` of `exp`. An unparseable `exp` counts
 * as expired.
 */
export function isWithinRenewWindow(exp: string | Date, withinMs: number, now: Date = new Date()): boolean {
  const expMs = exp instanceof Date ? exp.getTime() : Date.parse(exp);
  if (!Number.isFinite(expMs)) return true;
  return expMs - now.getTime() <= withinMs;
}
