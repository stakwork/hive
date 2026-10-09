/**
 * GET /api/workspaces/:slug/system-map/nodes
 *      — the workspace graph's `systemmap` namespace (nodes + the edges
 *      between them), read live from its swarm through boltwall (`:8444`).
 */

import { NextRequest } from "next/server";
import { SYSTEM_MAP_NAMESPACE } from "@/lib/system-map/domain-nodes";
import { handleSystemMapNodesRoute } from "@/lib/system-map/nodes-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return handleSystemMapNodesRoute(request, slug, SYSTEM_MAP_NAMESPACE);
}
