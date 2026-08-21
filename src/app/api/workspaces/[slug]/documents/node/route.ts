import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getSwarmVanityAddress } from "@/lib/constants";
import { getStakgraphUrl } from "@/lib/utils/stakgraph-url";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService = EncryptionService.getInstance();

/**
 * Resolves a graph node's file_url by ref_id from the workspace swarm.
 * Returns null if the node does not exist or has no file_url property.
 */
async function resolveNodeFileUrl(
  workspaceId: string,
  nodeId: string,
): Promise<string | null> {
  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: { name: true, swarmUrl: true, swarmApiKey: true },
  });

  if (!swarm?.swarmUrl || !swarm?.swarmApiKey) {
    return null;
  }

  let apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);
  if (process.env.CUSTOM_SWARM_API_KEY) {
    apiKey = process.env.CUSTOM_SWARM_API_KEY;
  }

  const stakgraphUrl = getStakgraphUrl(getSwarmVanityAddress(swarm.name));

  // Query the graph for the node by ref_id
  const params = new URLSearchParams({ ref_ids: nodeId, output: "json" });
  const res = await fetch(`${stakgraphUrl}/graph?${params.toString()}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": apiKey,
    },
  });

  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  const nodes: Array<{ properties?: Record<string, unknown> }> = data?.nodes ?? [];

  if (nodes.length === 0) {
    return null;
  }

  const fileUrl = nodes[0]?.properties?.file_url;
  return typeof fileUrl === "string" && fileUrl.length > 0 ? fileUrl : null;
}

/**
 * GET /api/workspaces/[slug]/documents/node?nodeId=<ref_id>
 *
 * Resolves a graph node by its ref_id and returns only its file_url.
 * Requires authenticated workspace membership (no role restriction).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    // 1. Auth: workspace membership required (not canAdmin — all members allowed)
    const access = await resolveWorkspaceAccess(request, { slug });
    const ok = requireMemberAccess(access);
    if (ok instanceof NextResponse) return ok;

    const { workspaceId } = ok;

    // 2. Validate nodeId query param
    const { searchParams } = new URL(request.url);
    const nodeId = searchParams.get("nodeId");
    if (!nodeId) {
      return NextResponse.json({ error: "nodeId required" }, { status: 400 });
    }

    // 3. Resolve file_url from graph — workspace membership already confirmed above
    const fileUrl = await resolveNodeFileUrl(workspaceId, nodeId);
    if (!fileUrl) {
      return NextResponse.json({ error: "No file URL on node" }, { status: 404 });
    }

    // 4. Return minimal payload — never the full node
    return NextResponse.json({ fileUrl });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
