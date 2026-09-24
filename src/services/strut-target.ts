/**
 * Which strut hive talks to — the ONE place the policy lives
 * (strut `plans/code-change.md` §5, "Keeping the target a policy").
 *
 * Every hive → strut interaction resolves its target here, once, at
 * dispatch: the org strut embed, `dispatch_strut`, a workflow-benchmark
 * run, a code-change preview. Nothing downstream re-runs the policy — a
 * `StrutRun` row records the resolved `swarmId`, and reconcile / cancel /
 * the "open in strut" link build their URLs from the row — so this can
 * move to per-swarm struts (or struts and gateways rolled up into each
 * other) without touching any caller again.
 *
 * ## The policy today
 *
 * | purpose       | target                                                  |
 * | ------------- | ------------------------------------------------------- |
 * | `code_change` | the ORG's default workspace swarm (the one the org strut |
 * | `embed`       | view embeds — `resolveOrgSwarmWorkspaceForUser`)        |
 * | `benchmark`   | the workspace's OWN swarm (what these callers always    |
 * | `chat`        | did — behaviour unchanged by the move onto the resolver) |
 *
 * Strut has no tenancy: one strut is one trust domain, which the org-wide
 * embed already assumes. A per-workspace strut for `code_change` is a
 * one-row change in `POLICY`.
 *
 * The result carries everything a caller needs to talk to the lab and to
 * bill the user: the decrypted swarm API key (mcp's `x-api-token` gate and
 * strut's `requireApiKey` bearer are the same value — see
 * `strut-delegation.ts`), and the actor string (`x-strut-actor`).
 */

import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { resolveOrgSwarmWorkspaceForUser } from "@/lib/helpers/org-workspace";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { resolveStrutActor } from "@/services/bifrost/strut-delegation";

export type StrutPurpose = "code_change" | "benchmark" | "chat" | "embed";

/** Where each purpose runs. `org-default` = the org's default workspace swarm. */
const POLICY: Record<StrutPurpose, "org-default" | "workspace"> = {
  code_change: "org-default",
  embed: "org-default",
  benchmark: "workspace",
  chat: "workspace",
};

export interface StrutTarget {
  /** `Swarm.id` — what a `StrutRun` row records. */
  swarmId: string;
  /** The workspace whose swarm this is — NOT necessarily the one asked about. */
  workspaceId: string;
  workspaceSlug: string;
  /** That workspace's `sourceControlOrgId` (for callers that check the org). */
  orgId: string | null;
  /** The stored swarm URL (`https://x.sphinx.chat/api`) — what `ensureStrutDelegation` takes. */
  swarmUrl: string;
  /** The swarm's stakgraph mcp root (`:3355`). */
  mcpBase: string;
  /** `{mcp}/lab` — the strut mount. */
  labBase: string;
  /** Decrypted. Never log it. */
  swarmApiKey: string;
  /** Who strut bills: the macaroon `user_id`, sent as `x-strut-actor`. */
  actor: string;
}

export type StrutTargetError =
  | { type: "WORKSPACE_NOT_FOUND" }
  | { type: "ACCESS_DENIED" }
  | { type: "SWARM_NOT_CONFIGURED" }
  | { type: "SWARM_NOT_ACTIVE"; status: string }
  /** org-default policy: no workspace in the org has a swarm the user can reach. */
  | { type: "NO_ORG_SWARM" }
  | { type: "DECRYPT_FAILED"; message: string };

export type StrutTargetResult =
  | { ok: true; target: StrutTarget }
  | { ok: false; error: StrutTargetError };

export interface ResolveStrutTargetArgs {
  purpose: StrutPurpose;
  userId: string;
  /** The workspace the caller acts in — by id or slug. Required unless `orgGithubLogin` is given. */
  workspaceId?: string;
  workspaceSlug?: string;
  /** For org-scoped callers with no workspace in hand (the embed). */
  orgGithubLogin?: string;
}

/** A human sentence for an error — for tool results and API responses. */
export function describeStrutTargetError(error: StrutTargetError): string {
  switch (error.type) {
    case "WORKSPACE_NOT_FOUND":
      return "Workspace not found.";
    case "ACCESS_DENIED":
      return "You do not have access to this workspace.";
    case "SWARM_NOT_CONFIGURED":
      return "The workspace has no swarm configured, so it has no strut.";
    case "SWARM_NOT_ACTIVE":
      return `The workspace swarm is not active (${error.status}).`;
    case "NO_ORG_SWARM":
      return "No swarm configured for any workspace in this org.";
    case "DECRYPT_FAILED":
      return `Failed to decrypt swarm credentials: ${error.message}`;
  }
}

function decryptSwarmKey(encrypted: string): { ok: true; key: string } | { ok: false; message: string } {
  try {
    return { ok: true, key: EncryptionService.getInstance().decryptField("swarmApiKey", encrypted) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function buildTarget(
  ws: { id: string; slug: string; sourceControlOrgId: string | null },
  swarm: { id: string; swarmUrl: string; swarmApiKey: string },
  userId: string,
): Promise<StrutTargetResult> {
  const decrypted = decryptSwarmKey(swarm.swarmApiKey);
  if (!decrypted.ok) return { ok: false, error: { type: "DECRYPT_FAILED", message: decrypted.message } };
  const mcpBase = transformSwarmUrlToRepo2Graph(swarm.swarmUrl);
  return {
    ok: true,
    target: {
      swarmId: swarm.id,
      workspaceId: ws.id,
      workspaceSlug: ws.slug,
      orgId: ws.sourceControlOrgId,
      swarmUrl: swarm.swarmUrl,
      mcpBase,
      labBase: `${mcpBase}/lab`,
      swarmApiKey: decrypted.key,
      actor: await resolveStrutActor(userId),
    },
  };
}

/** `workspace` policy: the named workspace's own swarm, access-checked like `getWorkspaceSwarmAccess`. */
async function resolveWorkspaceSwarm(args: ResolveStrutTargetArgs): Promise<StrutTargetResult> {
  const { userId, workspaceId, workspaceSlug } = args;
  if (!workspaceId && !workspaceSlug) return { ok: false, error: { type: "WORKSPACE_NOT_FOUND" } };
  const ws = await db.workspace.findFirst({
    where: { ...(workspaceId ? { id: workspaceId } : { slug: workspaceSlug }), deleted: false },
    select: {
      id: true,
      slug: true,
      ownerId: true,
      sourceControlOrgId: true,
      swarm: { select: { id: true, status: true, swarmUrl: true, swarmApiKey: true } },
      members: { where: { userId, leftAt: null }, select: { userId: true }, take: 1 },
    },
  });
  if (!ws) return { ok: false, error: { type: "WORKSPACE_NOT_FOUND" } };
  if (ws.ownerId !== userId && ws.members.length === 0) return { ok: false, error: { type: "ACCESS_DENIED" } };
  if (!ws.swarm || !ws.swarm.swarmUrl || !ws.swarm.swarmApiKey) {
    return { ok: false, error: { type: "SWARM_NOT_CONFIGURED" } };
  }
  if (ws.swarm.status !== "ACTIVE") return { ok: false, error: { type: "SWARM_NOT_ACTIVE", status: ws.swarm.status } };
  return buildTarget(ws, { id: ws.swarm.id, swarmUrl: ws.swarm.swarmUrl, swarmApiKey: ws.swarm.swarmApiKey }, userId);
}

/** `org-default` policy: the org's default workspace swarm for this user (else the first reachable one). */
async function resolveOrgDefaultSwarm(args: ResolveStrutTargetArgs): Promise<StrutTargetResult> {
  const { userId } = args;
  let githubLogin = args.orgGithubLogin;
  if (!githubLogin) {
    if (!args.workspaceId && !args.workspaceSlug) return { ok: false, error: { type: "WORKSPACE_NOT_FOUND" } };
    const ws = await db.workspace.findFirst({
      where: { ...(args.workspaceId ? { id: args.workspaceId } : { slug: args.workspaceSlug }), deleted: false },
      select: { sourceControlOrg: { select: { githubLogin: true } } },
    });
    if (!ws) return { ok: false, error: { type: "WORKSPACE_NOT_FOUND" } };
    githubLogin = ws.sourceControlOrg?.githubLogin;
    if (!githubLogin) return { ok: false, error: { type: "NO_ORG_SWARM" } };
  }
  const workspace = await resolveOrgSwarmWorkspaceForUser(githubLogin, userId);
  if (!workspace?.swarm) return { ok: false, error: { type: "NO_ORG_SWARM" } };
  const { swarm } = workspace;
  if (!swarm.swarmUrl || !swarm.swarmApiKey) return { ok: false, error: { type: "SWARM_NOT_CONFIGURED" } };
  return buildTarget(
    { id: workspace.id, slug: workspace.slug, sourceControlOrgId: workspace.sourceControlOrgId },
    { id: swarm.id, swarmUrl: swarm.swarmUrl, swarmApiKey: swarm.swarmApiKey },
    userId,
  );
}

/**
 * Resolve the strut a purpose runs on, for this user. Consulted ONCE at
 * dispatch; never from a stored row. Never throws for a policy miss —
 * the error names why so a route can pick its status code.
 */
export async function resolveStrutTarget(args: ResolveStrutTargetArgs): Promise<StrutTargetResult> {
  return POLICY[args.purpose] === "org-default" ? resolveOrgDefaultSwarm(args) : resolveWorkspaceSwarm(args);
}
