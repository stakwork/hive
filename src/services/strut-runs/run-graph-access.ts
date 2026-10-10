/**
 * Whether the person asking for a run's graph trace may read a PEER
 * workspace's graph — the one the run reached through another strut. The
 * same rule as the trace itself, on that workspace: its members.
 */

import type { NextRequest } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import type { PeerAccess } from "@/services/strut-runs/run-graph";

export function peerAccessFor(request: NextRequest): PeerAccess {
  return async (slug) => {
    const access = await resolveWorkspaceAccess(request, { slug });
    return access.kind === "member"
      ? { workspaceId: access.workspaceId }
      : { reason: `you are not a member of @${slug}` };
  };
}
