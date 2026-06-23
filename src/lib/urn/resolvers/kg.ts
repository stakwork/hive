/**
 * `kg` realm seam — resolves workspace slug to swarm credentials.
 *
 * This is a credential hand-off boundary only. No outbound HTTP call
 * is made into the swarm.
 *
 * IDOR guard: the caller's userId must be a member of the resolved
 * workspace before credentials are returned.
 */

import { db } from "@/lib/db";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { parseUrn } from "../parse";

export interface KgSeamResult {
  workspace: string;
  /** Stakgraph base URL (`:3355`) from swarm access — kept for callers that need it. */
  swarmUrl: string;
  /**
   * Jarvis knowledge-graph base URL (`:8444`). This is the endpoint the kg
   * realm actually talks to (`/v2/nodes`); stakgraph (`:3355`) does NOT serve
   * those routes. Derived from the swarm name, matching getJarvisConfigForWorkspace.
   */
  jarvisUrl: string;
  swarmApiKey: string;
}

export interface KgAccessContext {
  userId: string;
}

export async function resolveKgSeam(
  urn: string,
  ctx: KgAccessContext
): Promise<KgSeamResult | null> {
  const parsed = parseUrn(urn);
  if (!parsed || parsed.realm !== "kg") return null;

  const ws = await db.workspace.findFirst({
    where: { slug: parsed.workspace, deleted: false },
    select: { id: true },
  });
  if (!ws) return null;

  // Authorization: caller must be a member of this workspace BEFORE
  // any credential is fetched.
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId: ws.id, userId: ctx.userId },
    select: { id: true },
  });
  if (!member) return null;

  const result = await getSwarmAccessByWorkspaceId(ws.id);
  if (!result.success) return null;
  // Jarvis is addressed by swarm name (https://{name}.sphinx.chat:8444);
  // without a name we cannot reach the knowledge graph.
  if (!result.data.swarmName) return null;

  return {
    workspace: parsed.workspace,
    swarmUrl: result.data.swarmUrl,
    jarvisUrl: getJarvisUrl(result.data.swarmName),
    swarmApiKey: result.data.swarmApiKey,
  };
}
