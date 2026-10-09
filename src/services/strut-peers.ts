/**
 * The org strut's PEERS — what lets a job's agent or the strut builder call a
 * workflow (`explore`) on another workspace's strut (strut
 * `plans/federation.md` §2.2, §3), and what lets that strut bill the person
 * the call is for (strut `plans/org-gateway.md` §2–§3, narrowed to the calls
 * the org strut makes).
 *
 * Wherever hive hands the org strut a person — a job turn (`strut-jobs.ts`),
 * a builder dispatch (`dispatch_strut`), the strut UI's embed URL — for every
 * other ACTIVE workspace swarm in the org, in parallel:
 *
 *  1. **A peer record on the org strut**, named by the workspace's slug —
 *     what a person types as `@slug`. Hive mints a `lab:peer` token ON THAT
 *     SWARM and puts it on the org strut:
 *
 *         POST {its mcp}/mint-token        { scope: "lab:peer" }
 *         PUT  {org lab}/peers/{slug}       { baseUrl: {its lab}, token, label }
 *
 *     No `sub` on the token: the org strut forwards the person each run is
 *     for as `x-strut-actor`. Every turn, because strut reveals nothing about
 *     a token it holds and one lives 60 days — re-minting per turn keeps it
 *     alive with no store and no cron. A swarm whose mcp answers without
 *     `scope: "lab:peer"` (older than stakgraph#1754) gets no record: never
 *     an `api` token, which is that lab's admin. The records are the org
 *     strut's, not the person's: once pushed, every builder chat there lists
 *     them (`list_peers`).
 *  2. **The user's delegation on that swarm's strut, through the ORG strut's
 *     gateway**: the target bills the job owner's virtual key on the org
 *     strut's Bifrost, so nothing per workspace is needed there — no
 *     `BIFROST_ENABLED` entry for it, no membership of it. Listed first and
 *     pushed only when missing or past half-life (`ensureStrutDelegation`'s
 *     rule), and not recorded on the member row, which is the org strut's
 *     own desired state.
 *
 * Never throws and never fails the launch: a swarm that cannot be reached is
 * logged and skipped, and the job's call to it then fails in its run —
 * `peer_unknown:`, a 401, or a Mothership refusal — where the agent sees it.
 */

import { isBifrostEnabledForAgent, isBifrostEnabledForWorkspace } from "@/config/env";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { STRUT_DELEGATION_HTTP_TIMEOUT_MS } from "@/services/bifrost/constants";
import {
  isPastHalfLife,
  listStrutDelegations,
  pushStrutDelegation,
  STRUT_DELEGATION_AGENT,
  StrutDelegationsUnsupportedError,
  type StrutLabTarget,
} from "@/services/bifrost/strut-delegation";
import type { StrutTarget } from "@/services/strut-target";

const LOG_TAG = "STRUT_PEERS";

/** Another workspace's swarm the org strut may call. */
interface PeerSwarm {
  /** The workspace slug — the peer's id on the org strut. */
  slug: string;
  name: string;
  mcpBase: string;
  lab: StrutLabTarget;
}

export type PeerRecordStatus =
  | "pushed"
  /** The peer's mcp cannot mint a `lab:peer` token, or the org strut has no `/peers` route. */
  | "unsupported"
  | "failed";

export type PeerDelegationStatus = "skipped-gate" | "fresh" | "pushed" | "unsupported" | "failed";

export interface OrgStrutPeersResult {
  /** By workspace slug. */
  peers: Record<string, PeerRecordStatus>;
  delegations: Record<string, PeerDelegationStatus>;
}

/**
 * Peer records on the org strut for every other workspace swarm in its org,
 * and the user's delegation on each. Never throws.
 */
export async function ensureOrgStrutPeers(org: StrutTarget, userId: string): Promise<OrgStrutPeersResult> {
  const out: OrgStrutPeersResult = { peers: {}, delegations: {} };
  try {
    const swarms = await orgPeerSwarms(org);
    // The org strut's Bifrost bills these calls, so the org workspace's gate
    // is the one that matters (the peer's own may stay closed).
    const billable = isBifrostEnabledForWorkspace(org.workspaceSlug) && isBifrostEnabledForAgent(STRUT_DELEGATION_AGENT);
    await Promise.all(
      swarms.map(async (peer) => {
        const [record, delegation] = await Promise.all([
          pushPeerRecord(org, peer),
          billable ? ensurePeerDelegation(org, userId, peer) : Promise.resolve<PeerDelegationStatus>("skipped-gate"),
        ]);
        out.peers[peer.slug] = record;
        out.delegations[peer.slug] = delegation;
      }),
    );
  } catch (err) {
    logger.warn("Strut peers not ensured; launching without them", LOG_TAG, {
      org: org.workspaceSlug,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}

/** Every other ACTIVE workspace swarm in the org strut's org, one per swarm. */
async function orgPeerSwarms(org: StrutTarget): Promise<PeerSwarm[]> {
  if (!org.orgId) return [];
  const workspaces = await db.workspace.findMany({
    where: { sourceControlOrgId: org.orgId, deleted: false, swarm: { is: { status: "ACTIVE" } } },
    select: { slug: true, name: true, swarm: { select: { id: true, swarmUrl: true, swarmApiKey: true } } },
  });
  const encryption = EncryptionService.getInstance();
  const seen = new Set([org.swarmId]);
  const swarms: PeerSwarm[] = [];
  for (const ws of workspaces) {
    const swarm = ws.swarm;
    if (!swarm?.swarmUrl || !swarm.swarmApiKey || seen.has(swarm.id)) continue;
    seen.add(swarm.id);
    let swarmApiKey: string;
    try {
      swarmApiKey = encryption.decryptField("swarmApiKey", swarm.swarmApiKey);
    } catch (err) {
      logger.warn("Peer swarm key decrypt failed; skipping it", LOG_TAG, {
        peer: ws.slug,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const mcpBase = transformSwarmUrlToRepo2Graph(swarm.swarmUrl);
    swarms.push({ slug: ws.slug, name: ws.name, mcpBase, lab: { labBase: `${mcpBase}/lab`, swarmApiKey } });
  }
  return swarms;
}

/** Mint a `lab:peer` token on the peer's swarm and put it on the org strut. */
async function pushPeerRecord(org: StrutTarget, peer: PeerSwarm): Promise<PeerRecordStatus> {
  try {
    const minted = await fetch(`${peer.mcpBase}/mint-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": peer.lab.swarmApiKey },
      body: JSON.stringify({ scope: "lab:peer" }),
      cache: "no-store",
      signal: AbortSignal.timeout(STRUT_DELEGATION_HTTP_TIMEOUT_MS),
    });
    if (!minted.ok) {
      logger.warn("Peer token mint failed; no peer record", LOG_TAG, { peer: peer.slug, status: minted.status });
      return "failed";
    }
    const body = (await minted.json().catch(() => ({}))) as { token?: unknown; scope?: unknown };
    if (body.scope !== "lab:peer" || typeof body.token !== "string" || !body.token) {
      logger.info("Peer swarm's mcp cannot mint a lab:peer token yet; no peer record", LOG_TAG, { peer: peer.slug });
      return "unsupported";
    }
    const put = await fetch(`${org.labBase}/peers/${encodeURIComponent(peer.slug)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": org.swarmApiKey,
        Authorization: `Bearer ${org.swarmApiKey}`,
      },
      body: JSON.stringify({ baseUrl: peer.lab.labBase, token: body.token, label: peer.name }),
      cache: "no-store",
      signal: AbortSignal.timeout(STRUT_DELEGATION_HTTP_TIMEOUT_MS),
    });
    if (put.status === 404) {
      logger.info("Org strut has no /peers route yet; no peer record", LOG_TAG, { peer: peer.slug, org: org.workspaceSlug });
      return "unsupported";
    }
    if (!put.ok) {
      logger.warn("Peer record push failed", LOG_TAG, { peer: peer.slug, org: org.workspaceSlug, status: put.status });
      return "failed";
    }
    return "pushed";
  } catch (err) {
    logger.warn("Peer record push threw", LOG_TAG, {
      peer: peer.slug,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/** The user's delegation on the peer's strut, through the org strut's gateway. */
async function ensurePeerDelegation(org: StrutTarget, userId: string, peer: PeerSwarm): Promise<PeerDelegationStatus> {
  try {
    const listed = await listStrutDelegations(peer.lab);
    const current = listed.find((d) => d.actor === org.actor);
    if (current && !isPastHalfLife(current.exp)) return "fresh";
    await pushStrutDelegation({
      workspaceId: org.workspaceId,
      userId,
      swarmUrl: org.swarmUrl,
      target: peer.lab,
      record: false,
    });
    return "pushed";
  } catch (err) {
    if (err instanceof StrutDelegationsUnsupportedError) return "unsupported";
    logger.warn("Peer delegation push failed", LOG_TAG, {
      peer: peer.slug,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}
