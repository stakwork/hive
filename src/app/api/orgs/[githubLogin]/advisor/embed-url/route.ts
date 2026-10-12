import { NextRequest, NextResponse } from "next/server";

import { resolveOrgDefaultSwarmWorkspace } from "@/lib/helpers/org-workspace";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { transformSwarmUrlToAdvisor } from "@/lib/utils/swarm";
import { validateWorkspaceAccess } from "@/services/workspace";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

/**
 * POST /api/orgs/[githubLogin]/advisor/embed-url
 *
 * Returns the iframe URL for the org's default-workspace swarm's AWS
 * Advisor (`https://advisor-<label>.sphinx.chat`), derived purely from the
 * swarm's public `swarmUrl` — Hive never reads or decrypts `swarmApiKey`
 * and never mints anything for the advisor (no `resolveStrutTarget`, no
 * new target purpose). Users sign in inside the advisor with its own
 * token, which Hive never sees.
 *
 * 1. Auth.
 * 2. `resolveOrgDefaultSwarmWorkspace` — the org's default workspace only,
 *    with NO fallback to any other workspace in the org, so the advisor
 *    always resolves to one specific swarm.
 * 3. Role gate: only an Owner or Admin of that workspace may get the URL.
 *    This runs BEFORE the advisor URL is derived, so the host is never
 *    handed to anyone who isn't an admin.
 * 4. Derive the advisor URL from `swarm.swarmUrl`.
 *
 * IMPORTANT: this 403 is a UX gate only, not the real access boundary —
 * the advisor URL is deterministic from the swarm host, so any VPN user
 * could work it out and open it directly. The advisor's own `API_TOKEN`
 * is what actually protects it; see the Advisor feature docs.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  const workspace = await resolveOrgDefaultSwarmWorkspace(githubLogin);
  if (!workspace?.swarm) {
    return NextResponse.json(
      { error: "Advisor is not configured for this org", reason: "not_configured" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const access = await validateWorkspaceAccess(workspace.slug, userOrResponse.id);
  if (!access.canAdmin) {
    return NextResponse.json(
      { error: "Owner or Admin access required to open the Advisor", reason: "no_access" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const url = transformSwarmUrlToAdvisor(workspace.swarm.swarmUrl);
  if (!url) {
    return NextResponse.json(
      { error: "Advisor is not configured for this org", reason: "not_configured" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    { url, workspaceSlug: workspace.slug },
    { headers: NO_STORE_HEADERS },
  );
}
