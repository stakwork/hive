import { NextRequest, NextResponse } from "next/server";

import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { mintGatewayTicket } from "@/lib/helpers/gateway-ticket";

/**
 * POST /api/orgs/[githubLogin]/gateway/ticket
 *
 * Mints a short-lived single-use bootstrap ticket for the gateway
 * plugin's admin UI, so Hive can embed it as an iframe without the
 * user ever seeing a login screen.
 *
 * Resolution order:
 *  1. Auth + org access via the standard middleware probe.
 *  2. Pick the first workspace in this org the user has access to
 *     (orgs are 1:N with workspaces but every workspace in the org
 *     has its own swarm + gateway; we choose the first reachable one).
 *  3. Decrypt the swarm's `swarmApiKey` (= gateway provisioning
 *     token).
 *  4. POST `{gateway}/_plugin/auth/ticket` with `Bearer <token>`.
 *  5. Return `{url, ticket}` to the client; client constructs
 *     `${url}/_plugin/ui/?ticket=${ticket}` and shoves that into an
 *     iframe.
 *
 * The ticket is server-tracked, single-use, and expires in ~30s, so
 * leaking it via referrer / logs has a very small replay window.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  const result = await mintGatewayTicket(githubLogin, userId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ url: result.url, ticket: result.ticket });
}
