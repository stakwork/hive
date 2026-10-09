/**
 * The org strut's PEERS, kept by a daily cron (`/api/cron/strut-peers`) — what
 * lets a job's agent or the strut builder on the org strut call a workflow
 * (`explore`) on another workspace's strut (strut `plans/federation.md` §2.2,
 * §3), and what lets that strut bill the person the call is for (strut
 * `plans/org-gateway.md` §2–§3, narrowed to the calls the org strut makes).
 *
 * The org strut is the org's DEFAULT workspace's swarm (`defaultWorkspaceId`,
 * as the other org-level crons resolve it); an org without one is skipped.
 * For every other ACTIVE workspace swarm in the org:
 *
 *  1. **A peer record on the org strut**, named by the workspace's slug —
 *     what a person types as `@slug`:
 *
 *         POST {its mcp}/mint-token        { scope: "lab:peer" }
 *         PUT  {org lab}/peers/{slug}       { baseUrl: {its lab}, token, label }
 *
 *     No `sub`: the org strut forwards each run's person as `x-strut-actor`.
 *     Re-minted every pass — a token lives 60 days and strut reveals nothing
 *     about one it holds. A swarm whose mcp answers without
 *     `scope: "lab:peer"` (older than stakgraph#1754) gets no record: never
 *     an `api` token, which is that lab's admin.
 *  2. **The org strut's users' delegations on that swarm's strut**, minted
 *     for the ORG workspace — its virtual key, the org strut's gateway — so a
 *     call there bills the person through the org gateway and nothing per
 *     workspace is needed: no `BIFROST_ENABLED` entry for the peer, no
 *     membership of it. The users are the org workspace's members whose own
 *     delegation is on record (`strutDelegationId`): the people hive has
 *     handed the org strut. Pushed when missing or inside the renew window,
 *     and never recorded on the member row (`record: false`) — that row is
 *     the org strut's own desired state.
 *
 * Nothing here runs on a request: a job turn, a builder dispatch and the
 * embed only use what the last pass left. A new swarm, or a person's first
 * use of the org strut, is picked up by the next pass; a swarm that is down
 * costs this pass a timeout and nobody a wait.
 */

import { isBifrostEnabledForAgent, isBifrostEnabledForWorkspace } from "@/config/env";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { STRUT_DELEGATION_HTTP_TIMEOUT_MS, STRUT_DELEGATION_RENEW_WITHIN_MS } from "@/services/bifrost/constants";
import {
  isWithinRenewWindow,
  listStrutDelegations,
  pushStrutDelegation,
  STRUT_DELEGATION_AGENT,
  StrutDelegationsUnsupportedError,
  type StrutLabTarget,
} from "@/services/bifrost/strut-delegation";

const LOG_TAG = "STRUT_PEERS";

export interface StrutPeersReconcileError {
  /** The org's `githubLogin`. */
  org: string;
  /** The peer's workspace slug, when the error is about one. */
  peer?: string;
  actor?: string;
  error: string;
}

export interface StrutPeersReconcileResult {
  success: boolean;
  /** Orgs whose org strut was synced. */
  orgsProcessed: number;
  /** Peer records put on an org strut. */
  peersPushed: number;
  /** Peers whose mcp cannot mint a `lab:peer` token yet, or whose org strut has no `/peers` route. */
  peersUnsupported: number;
  /** Delegations put on a peer's strut. */
  delegationsPushed: number;
  errors: StrutPeersReconcileError[];
  timestamp: Date;
}

export interface StrutPeersReconcileOptions {
  /** Injectable clock (tests). */
  now?: Date;
  /** Scope the pass to one org by `githubLogin` (debugging). */
  org?: string;
}

/** A workspace's strut lab: where it is and how to reach it. */
interface StrutSwarm {
  workspaceId: string;
  slug: string;
  name: string;
  swarmId: string;
  swarmUrl: string;
  mcpBase: string;
  lab: StrutLabTarget;
}

/** Someone the org strut runs things for. */
interface OrgStrutUser {
  userId: string;
  actor: string;
}

type SwarmRow = {
  id: string;
  slug: string;
  name: string;
  swarm: { id: string; swarmUrl: string | null; swarmApiKey: string | null } | null;
};

const SWARM_SELECT = { id: true, swarmUrl: true, swarmApiKey: true } as const;

/** One pass over every org with an org strut. Errors are collected, never thrown per org. */
export async function runStrutPeersReconcile(options: StrutPeersReconcileOptions = {}): Promise<StrutPeersReconcileResult> {
  const now = options.now ?? new Date();
  const result: StrutPeersReconcileResult = {
    success: true,
    orgsProcessed: 0,
    peersPushed: 0,
    peersUnsupported: 0,
    delegationsPushed: 0,
    errors: [],
    timestamp: now,
  };

  const orgs = await db.sourceControlOrg.findMany({
    where: {
      ...(options.org ? { githubLogin: options.org } : {}),
      defaultWorkspace: { is: { deleted: false, swarm: { is: { status: "ACTIVE" } } } },
    },
    select: {
      id: true,
      githubLogin: true,
      defaultWorkspace: { select: { id: true, slug: true, name: true, swarm: { select: SWARM_SELECT } } },
    },
  });

  for (const org of orgs) {
    try {
      await reconcileOrg(org, now, result);
    } catch (err) {
      result.errors.push({ org: org.githubLogin, error: err instanceof Error ? err.message : String(err) });
    }
  }

  result.success = result.errors.length === 0;
  logger.info("Strut peers reconcile finished", LOG_TAG, {
    orgsProcessed: result.orgsProcessed,
    peersPushed: result.peersPushed,
    peersUnsupported: result.peersUnsupported,
    delegationsPushed: result.delegationsPushed,
    errors: result.errors.length,
  });
  return result;
}

async function reconcileOrg(
  org: { id: string; githubLogin: string; defaultWorkspace: SwarmRow | null },
  now: Date,
  result: StrutPeersReconcileResult,
): Promise<void> {
  const home = org.defaultWorkspace ? toStrutSwarm(org.defaultWorkspace) : null;
  if (!home) {
    result.errors.push({ org: org.githubLogin, error: "the org strut's swarm has no usable URL or key" });
    return;
  }
  const peers = await otherSwarms(org.id, home, org.githubLogin, result);
  result.orgsProcessed++;
  if (peers.length === 0) return;

  // 1. The peer records, every pass.
  await Promise.all(
    peers.map(async (peer) => {
      const pushed = await pushPeerRecord(home, peer);
      if (pushed.status === "pushed") result.peersPushed++;
      else if (pushed.status === "unsupported") result.peersUnsupported++;
      else result.errors.push({ org: org.githubLogin, peer: peer.slug, error: pushed.error });
    }),
  );

  // 2. The users' delegations, through the org strut's gateway — behind the
  // ORG workspace's gates, the one gateway that bills these calls.
  if (!isBifrostEnabledForWorkspace(home.slug) || !isBifrostEnabledForAgent(STRUT_DELEGATION_AGENT)) return;
  const users = await orgStrutUsers(home.workspaceId);
  if (users.length === 0) return;
  await Promise.all(peers.map((peer) => pushPeerDelegations(org.githubLogin, home, peer, users, now, result)));
}

function toStrutSwarm(ws: SwarmRow): StrutSwarm | null {
  if (!ws.swarm?.swarmUrl || !ws.swarm.swarmApiKey) return null;
  const swarmApiKey = EncryptionService.getInstance().decryptField("swarmApiKey", ws.swarm.swarmApiKey);
  const mcpBase = transformSwarmUrlToRepo2Graph(ws.swarm.swarmUrl);
  return {
    workspaceId: ws.id,
    slug: ws.slug,
    name: ws.name,
    swarmId: ws.swarm.id,
    swarmUrl: ws.swarm.swarmUrl,
    mcpBase,
    lab: { labBase: `${mcpBase}/lab`, swarmApiKey },
  };
}

/** Every other ACTIVE workspace swarm in the org, one per swarm. */
async function otherSwarms(
  orgId: string,
  home: StrutSwarm,
  orgLogin: string,
  result: StrutPeersReconcileResult,
): Promise<StrutSwarm[]> {
  const workspaces = await db.workspace.findMany({
    where: { sourceControlOrgId: orgId, deleted: false, swarm: { is: { status: "ACTIVE" } } },
    select: { id: true, slug: true, name: true, swarm: { select: SWARM_SELECT } },
  });
  const seen = new Set([home.swarmId]);
  const swarms: StrutSwarm[] = [];
  for (const ws of workspaces) {
    if (!ws.swarm || seen.has(ws.swarm.id)) continue;
    seen.add(ws.swarm.id);
    try {
      const swarm = toStrutSwarm(ws);
      if (swarm) swarms.push(swarm);
    } catch (err) {
      result.errors.push({
        org: orgLogin,
        peer: ws.slug,
        error: `swarmApiKey decrypt failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return swarms;
}

/** The org workspace's members with a delegation of their own on the org strut. */
async function orgStrutUsers(workspaceId: string): Promise<OrgStrutUser[]> {
  const members = await db.workspaceMember.findMany({
    where: { workspaceId, leftAt: null, strutDelegationId: { not: null } },
    select: { userId: true, user: { select: { githubAuth: { select: { githubUsername: true } } } } },
  });
  const { buildBifrostName } = await import("@/services/bifrost/reconciler");
  return members.map((m) => ({
    userId: m.userId,
    actor: buildBifrostName(m.userId, m.user?.githubAuth?.githubUsername ?? null),
  }));
}

/** Mint a `lab:peer` token on the peer's swarm and put it on the org strut. */
async function pushPeerRecord(
  home: StrutSwarm,
  peer: StrutSwarm,
): Promise<{ status: "pushed" } | { status: "unsupported" } | { status: "failed"; error: string }> {
  try {
    const minted = await fetch(`${peer.mcpBase}/mint-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": peer.lab.swarmApiKey },
      body: JSON.stringify({ scope: "lab:peer" }),
      cache: "no-store",
      signal: AbortSignal.timeout(STRUT_DELEGATION_HTTP_TIMEOUT_MS),
    });
    if (!minted.ok) return { status: "failed", error: `POST /mint-token returned ${minted.status}` };
    const body = (await minted.json().catch(() => ({}))) as { token?: unknown; scope?: unknown };
    if (body.scope !== "lab:peer" || typeof body.token !== "string" || !body.token) {
      logger.info("Peer swarm's mcp cannot mint a lab:peer token yet; no peer record", LOG_TAG, { peer: peer.slug });
      return { status: "unsupported" };
    }
    const put = await fetch(`${home.lab.labBase}/peers/${encodeURIComponent(peer.slug)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": home.lab.swarmApiKey,
        Authorization: `Bearer ${home.lab.swarmApiKey}`,
      },
      body: JSON.stringify({ baseUrl: peer.lab.labBase, token: body.token, label: peer.name }),
      cache: "no-store",
      signal: AbortSignal.timeout(STRUT_DELEGATION_HTTP_TIMEOUT_MS),
    });
    if (put.status === 404) {
      logger.info("Org strut has no /peers route yet; no peer record", LOG_TAG, { peer: peer.slug, org: home.slug });
      return { status: "unsupported" };
    }
    if (!put.ok) return { status: "failed", error: `PUT /peers/${peer.slug} returned ${put.status}` };
    return { status: "pushed" };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** The org strut's users' delegations on one peer's strut, through the org strut's gateway. */
async function pushPeerDelegations(
  orgLogin: string,
  home: StrutSwarm,
  peer: StrutSwarm,
  users: OrgStrutUser[],
  now: Date,
  result: StrutPeersReconcileResult,
): Promise<void> {
  let listed;
  try {
    listed = await listStrutDelegations(peer.lab);
  } catch (err) {
    if (err instanceof StrutDelegationsUnsupportedError) return;
    result.errors.push({
      org: orgLogin,
      peer: peer.slug,
      error: `GET /llm/delegations failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }
  const byActor = new Map(listed.map((d) => [d.actor, d]));
  for (const user of users) {
    const current = byActor.get(user.actor);
    if (current && !isWithinRenewWindow(current.exp, STRUT_DELEGATION_RENEW_WITHIN_MS, now)) continue;
    try {
      await pushStrutDelegation({
        workspaceId: home.workspaceId,
        userId: user.userId,
        swarmUrl: home.swarmUrl,
        target: peer.lab,
        record: false,
      });
      result.delegationsPushed++;
    } catch (err) {
      result.errors.push({
        org: orgLogin,
        peer: peer.slug,
        actor: user.actor,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
