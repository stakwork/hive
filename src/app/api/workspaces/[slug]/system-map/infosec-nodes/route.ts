/**
 * GET /api/workspaces/:slug/system-map/infosec-nodes
 *      — the workspace graph's `infosec` namespace (nodes + the edges
 *      between them), read live from its swarm through boltwall (`:8444`).
 *      Backs the workflow inspector's SystemMap tab
 *      (`swarm-systemmap-cwe-check-templates`).
 *
 *      The server always selects `infosec` — there is no client-supplied
 *      namespace query param, and this route must never fall back to
 *      `systemmap` or the unnamed default namespace.
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
