import { NextRequest, NextResponse } from "next/server";

import { resolveOrgSwarmWorkspaceForUser } from "@/lib/helpers/org-workspace";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getBaseUrl } from "@/lib/utils";
import { mintStrutEmbedUrl, strutTargetErrorResponse } from "@/services/strut-embed";
import { resolveStrutTarget } from "@/services/strut-target";
import { validateWorkspaceAccess } from "@/services/workspace";

export const runtime = "nodejs";

/** Matches the gateway embed's session length; `StrutView` re-mints before it lapses. */
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

/**
 * POST /api/orgs/[githubLogin]/strut/embed-url
 *
 * Builds the iframe URL for the strut lab UI served by the org swarm's
 * stakgraph mcp at `/lab`, so Hive can embed it without the user ever
 * seeing the lab's Basic-auth prompt.
 *
 *  1. Auth, then find which workspace the org's strut resolves to
 *     (`resolveOrgSwarmWorkspaceForUser`: the default workspace's swarm
 *     first — the same swarm the Gateway view embeds). This lookup never
 *     touches the swarm's encrypted API key.
 *  2. Role gate: only an Owner or Admin of that workspace may open the
 *     shell — the same gate the workspace embed route enforces, so a
 *     VIEWER/DEVELOPER can't reach it through the org's first-reachable
 *     fallback either. This MUST pass before any credential is decrypted.
 *  3. Only once admin access is confirmed do we resolve the full strut
 *     target (`resolveStrutTarget`, purpose "embed") and call
 *     `mintStrutEmbedUrl`, which decrypts `swarmApiKey`, mints an mcp
 *     token, pushes the standing Bifrost delegation + Hive callback key,
 *     and returns `{mcp}/lab/?key=<jwt>`. The raw key never leaves the
 *     server.
 *
 * The JWT's `sub` is the user's actor string (the macaroon `user_id`), so
 * strut bills what the user does in the embed to them.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  // Find the workspace WITHOUT decrypting its swarm credentials, so the
  // Owner/Admin gate below runs before any secret is touched.
  const orgWorkspace = await resolveOrgSwarmWorkspaceForUser(githubLogin, userOrResponse.id);
  if (!orgWorkspace?.swarm) {
    return NextResponse.json(
      { error: "No swarm configured for any workspace in this org" },
      { status: 404 },
    );
  }

  const access = await validateWorkspaceAccess(orgWorkspace.slug, userOrResponse.id);
  if (!access.canAdmin) {
    return NextResponse.json(
      { error: "Owner or Admin access required to open Strut" },
      { status: 403 },
    );
  }

  // Only now — access confirmed — resolve the full target (decrypts the
  // swarm API key) and mint.
  const resolved = await resolveStrutTarget({
    purpose: "embed",
    orgGithubLogin: githubLogin,
    userId: userOrResponse.id,
  });
  if (!resolved.ok) {
    const { status, error } = strutTargetErrorResponse(resolved.error);
    return NextResponse.json({ error }, { status });
  }
  const { target } = resolved;

  const minted = await mintStrutEmbedUrl(target, {
    userId: userOrResponse.id,
    host: getBaseUrl(request.headers.get("host")),
    ttlSeconds: TOKEN_TTL_SECONDS,
  });
  if (!minted.ok) {
    return NextResponse.json({ error: minted.error }, { status: minted.status });
  }

  return NextResponse.json(
    { url: minted.url, workspaceSlug: target.workspaceSlug, expiresInSeconds: minted.expiresInSeconds },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
