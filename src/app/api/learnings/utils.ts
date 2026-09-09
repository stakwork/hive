import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

/**
 * Resolve the swarm credentials for a workspace.
 *
 * NOTE: this helper does NOT perform any access control. Callers MUST
 * authorize the request first (e.g. via `resolveWorkspaceAccess` +
 * `requireReadAccess`/`requireMemberAccess`) and only pass the resolved
 * workspaceId here.
 */
export async function getSwarmConfig(workspaceId: string) {
  const swarm = await db.swarm.findFirst({
    where: { workspaceId },
  });

  if (!swarm) {
    return { error: "Swarm not found for this workspace", status: 404 } as const;
  }

  if (!swarm.swarmUrl) {
    return { error: "Swarm URL not configured", status: 404 } as const;
  }

  const encryptionService: EncryptionService = EncryptionService.getInstance();
  const decryptedSwarmApiKey = encryptionService.decryptField(
    "swarmApiKey",
    swarm.swarmApiKey || "",
  );

  const swarmUrlObj = new URL(swarm.swarmUrl);
  let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
  if (swarm.swarmUrl.includes("localhost")) {
    baseSwarmUrl = `http://localhost:3355`;
  }

  return { baseSwarmUrl, decryptedSwarmApiKey } as const;
}

export type ProposalDecisionAction = "accept" | "reject";

export interface DecideProposalArgs {
  id: string;
  action: ProposalDecisionAction;
  base: string;
  apiKey: string;
  decidedBy: string;
  extraBody?: {
    force?: boolean;
    reason?: string;
  };
}

export interface DecideProposalResult {
  id: string;
  status: number;
  body: unknown;
}

/**
 * POST a single accept/reject to an already-resolved swarm (or mock) base.
 *
 * Callers pass `base`/`apiKey` — this helper does not resolve workspace access
 * or call `getSwarmConfig`. `id` is encoded here so untrusted bulk ids cannot
 * traverse the upstream path. The upstream body is built from `decidedBy` plus
 * explicit `extraBody` fields only; caller-supplied objects are never spread.
 */
export async function decideProposal({
  id,
  action,
  base,
  apiKey,
  decidedBy,
  extraBody,
}: DecideProposalArgs): Promise<DecideProposalResult> {
  const upstream = `${base}/gitree/proposals/${encodeURIComponent(id)}/${action}`;

  const payload: { decidedBy: string; force?: boolean; reason?: string } = {
    decidedBy,
  };
  if (typeof extraBody?.force === "boolean") {
    payload.force = extraBody.force;
  }
  if (typeof extraBody?.reason === "string") {
    payload.reason = extraBody.reason;
  }

  const response = await fetch(upstream, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": apiKey,
    },
    body: JSON.stringify(payload),
  });

  // Guard the parse: a non-JSON upstream body (proxy 502 HTML, empty 204)
  // must not collapse the real status into a generic 500 — especially here,
  // where the decision may already have been applied upstream.
  const body = await response.json().catch(() => ({
    error: `Upstream returned a non-JSON response (status ${response.status})`,
  }));

  return { id, status: response.status, body };
}
