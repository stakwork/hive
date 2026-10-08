/**
 * GET /api/workspaces/:slug/system-map/infosec-nodes
 *      — the workspace graph's `infosec` namespace (nodes + the edges
 *      between them), written by `swarm-systemmap-cwe-check-templates`.
 *      Backs the System Map page's CWE check tab.
 */

import { NextRequest } from "next/server";
import { INFOSEC_NAMESPACE } from "@/lib/system-map/domain-nodes";
import { handleSystemMapNodesRoute } from "@/lib/system-map/nodes-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return handleSystemMapNodesRoute(request, slug, INFOSEC_NAMESPACE);
}
