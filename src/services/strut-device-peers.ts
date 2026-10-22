/**
 * A paired device's strut PEERS — what a person's laptop strut holds: one
 * record per org they belong to, that org's central strut, with a
 * `lab:peer` token minted FOR THE PERSON (strut
 * `plans/chained-orchestrators.md` §4). Served at pairing and by the
 * device's renewal, `GET /api/strut-devices/peers`
 * (`lib/strut-devices.ts`).
 *
 * Per org, the central strut is the one Jamie's orchestrator turns run on
 * for this person (`resolveStrutTarget`, purpose `orchestrator`), and the
 * token is minted on that swarm's mcp:
 *
 *     POST {mcp}/mint-token  { scope: "lab:peer", sub: <actor>, expires_in: "7d" }
 *
 * `sub` is the person's strut actor (`resolveStrutActor`), the same id hive
 * sends as `x-strut-actor` on its own launches. Since stakgraph#1811 the lab
 * maps a `lab:peer` JWT with a `sub` to strut's `peer:person` scope: it may
 * launch the `orchestrator` (`peer: person`), open sessions under `<actor>/…`
 * as they are (`<actor>/<peer id>` is the thread Jamie uses too,
 * `orchestratorSessionId`), and join the person's room at `/lab/rooms`.
 * A swarm whose mcp answers without the `sub` gets no record: a token
 * without one is a strut's, never a person's.
 *
 * The record is strut's `PUT /peers/:id` body plus its id — the
 * `STRUT_PEERS` entry shape — so the desktop writes each as it comes. The
 * cron's strut-to-strut records (`services/strut-peers.ts`) are untouched.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { STRUT_DELEGATION_HTTP_TIMEOUT_MS } from "@/services/bifrost/constants";
import { resolveStrutActor } from "@/services/bifrost/strut-delegation";
import { describeStrutTargetError, resolveStrutTarget, type StrutTarget } from "@/services/strut-target";

const LOG_TAG = "STRUT_DEVICE_PEERS";

/** A person's peer token's life on the swarm. The device renews daily. */
export const DEVICE_PEER_TOKEN_TTL = "7d";
const DEVICE_PEER_TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

/** One org's central strut, as the laptop's strut keeps it (`PUT /peers/:id`). */
export interface StrutPeerRecord {
  /** The org's default workspace slug — the strut's own `self` id and the `<org>` of the person's session. */
  id: string;
  /** The central strut's lab: `{mcp}/lab`. */
  baseUrl: string;
  /** A `lab:peer` JWT whose `sub` is the person. */
  token: string;
  label: string;
  description?: string;
  repos?: string[];
}

export interface StrutDevicePeers {
  /** The person's strut actor: every token's `sub`, the `<person>` of `<person>/<org>`. */
  actor: string;
  peers: StrutPeerRecord[];
  /** When the tokens just minted expire. */
  expiresAt: string;
  /** Orgs that got no record this time, and why. */
  errors: { org: string; error: string }[];
}

/** The workspaces a person can reach: owned, or a member who has not left. */
const reachableBy = (userId: string) => ({
  deleted: false,
  OR: [{ ownerId: userId }, { members: { some: { userId, leftAt: null } } }],
});

/** The orgs a pairing would connect — what the approve page names. No tokens. */
export async function pairableOrgs(userId: string): Promise<{ githubLogin: string; name: string }[]> {
  const orgs = await db.sourceControlOrg.findMany({
    where: { workspaces: { some: { ...reachableBy(userId), swarm: { isNot: null } } } },
    select: { githubLogin: true, name: true },
    orderBy: { githubLogin: "asc" },
  });
  return orgs.map((o) => ({ githubLogin: o.githubLogin, name: o.name?.trim() || o.githubLogin }));
}

/** Fresh records, with fresh tokens, for every org the person belongs to. Never throws for one org. */
export async function strutPeersForUser(userId: string, now: Date = new Date()): Promise<StrutDevicePeers> {
  const actor = await resolveStrutActor(userId);
  const orgs = await db.sourceControlOrg.findMany({
    where: { workspaces: { some: { ...reachableBy(userId), swarm: { isNot: null } } } },
    select: {
      githubLogin: true,
      name: true,
      description: true,
      workspaces: {
        where: reachableBy(userId),
        select: { slug: true, repositories: { select: { repositoryUrl: true }, orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { githubLogin: "asc" },
  });

  const errors: StrutDevicePeers["errors"] = [];
  const records = await Promise.all(
    orgs.map(async (org): Promise<StrutPeerRecord | null> => {
      try {
        const resolved = await resolveStrutTarget({ purpose: "orchestrator", userId, orgGithubLogin: org.githubLogin });
        if (!resolved.ok) {
          errors.push({ org: org.githubLogin, error: describeStrutTargetError(resolved.error) });
          return null;
        }
        const target = resolved.target;
        const token = await mintPersonPeerToken(target, actor);
        const repos = [...new Set(org.workspaces.flatMap((w) => w.repositories.map((r) => r.repositoryUrl)))];
        const description = [org.description?.trim(), `Workspaces: ${org.workspaces.map((w) => w.slug).join(", ")}.`]
          .filter(Boolean)
          .join(" ");
        return {
          id: target.workspaceSlug,
          baseUrl: target.labBase,
          token,
          label: org.name?.trim() || org.githubLogin,
          description,
          ...(repos.length ? { repos } : {}),
        };
      } catch (err) {
        errors.push({ org: org.githubLogin, error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    }),
  );

  const peers = records.filter((r): r is StrutPeerRecord => r !== null);
  if (errors.length) logger.warn("Some orgs got no strut peer record", LOG_TAG, { userId, errors });
  return { actor, peers, expiresAt: new Date(now.getTime() + DEVICE_PEER_TOKEN_TTL_MS).toISOString(), errors };
}

/** A `lab:peer` token for `actor` on the target's swarm, with the swarm's own key. */
async function mintPersonPeerToken(target: StrutTarget, actor: string): Promise<string> {
  const res = await fetch(`${target.mcpBase}/mint-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-token": target.swarmApiKey },
    body: JSON.stringify({ scope: "lab:peer", sub: actor, expires_in: DEVICE_PEER_TOKEN_TTL }),
    cache: "no-store",
    signal: AbortSignal.timeout(STRUT_DELEGATION_HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`POST /mint-token returned ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { token?: unknown; scope?: unknown; sub?: unknown };
  if (body.scope !== "lab:peer" || body.sub !== actor || typeof body.token !== "string" || !body.token) {
    throw new Error("this swarm's mcp cannot mint a person's lab:peer token yet");
  }
  return body.token;
}
