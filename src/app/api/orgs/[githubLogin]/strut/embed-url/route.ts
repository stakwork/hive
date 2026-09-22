import { NextRequest, NextResponse } from "next/server";

import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { EncryptionService } from "@/lib/encryption";
import { resolveOrgSwarmWorkspaceForUser } from "@/lib/helpers/org-workspace";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import {
  ensureStrutDelegation,
  resolveStrutActor,
} from "@/services/bifrost/strut-delegation";

export const runtime = "nodejs";

/** Matches the gateway embed's session length; `StrutView` re-mints before it lapses. */
const TOKEN_TTL = "8h";
const MINT_TIMEOUT_MS = 10_000;

/**
 * POST /api/orgs/[githubLogin]/strut/embed-url
 *
 * Builds the iframe URL for the strut lab UI served by the org swarm's
 * stakgraph mcp at `/lab`, so Hive can embed it without the user ever
 * seeing the lab's Basic-auth prompt.
 *
 *  1. Auth, then resolve the org's swarm workspace (default workspace
 *     first — the same swarm the Gateway view embeds).
 *  2. Decrypt `swarmApiKey` and POST `{mcp}/mint-token` with it. mcp
 *     returns a short-lived JWT; the raw key never leaves the server.
 *  3. Return `{mcp}/lab/?key=<jwt>`. The strut UI stashes `?key=` in
 *     sessionStorage, strips it from the URL, and replays it as
 *     `Authorization: Bearer` on every request — which mcp's lab gate
 *     accepts alongside its Basic / `x-api-token` credentials.
 *
 * The JWT's `sub` is the user's actor string (the macaroon `user_id`), so
 * strut bills what the user does in the embed to them; and, behind the
 * Bifrost gates, the route makes sure the swarm's strut holds a live
 * standing delegation for that user (`ensureStrutDelegation`). A failed
 * push never blocks the embed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  const workspace = await resolveOrgSwarmWorkspaceForUser(
    githubLogin,
    userOrResponse.id,
  );
  if (!workspace || !workspace.swarm) {
    return NextResponse.json(
      { error: "No swarm configured for any workspace in this org" },
      { status: 404 },
    );
  }
  const { swarm } = workspace;
  if (!swarm.swarmUrl || !swarm.swarmApiKey) {
    return NextResponse.json(
      { error: "Swarm is missing swarmUrl or swarmApiKey" },
      { status: 503 },
    );
  }

  let apiToken: string;
  try {
    apiToken = EncryptionService.getInstance().decryptField(
      "swarmApiKey",
      swarm.swarmApiKey,
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to decrypt swarmApiKey: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 },
    );
  }

  const baseUrl = transformSwarmUrlToRepo2Graph(swarm.swarmUrl);
  const actor = await resolveStrutActor(userOrResponse.id);

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/mint-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": apiToken,
      },
      body: JSON.stringify({ expires_in: TOKEN_TTL, sub: actor }),
      cache: "no-store",
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });
  } catch (err) {
    const msg =
      (err as Error).name === "TimeoutError"
        ? `strut token mint timed out after ${MINT_TIMEOUT_MS}ms`
        : `strut token mint failed: ${err instanceof Error ? err.message : String(err)}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return NextResponse.json(
      { error: `strut token mint returned ${resp.status}: ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const body = (await resp.json()) as { token?: string };
  if (!body?.token) {
    return NextResponse.json(
      { error: "strut token mint returned no token" },
      { status: 502 },
    );
  }

  // Never throws: a failed push is logged and the embed goes ahead.
  await ensureStrutDelegation(
    { workspaceId: workspace.id, workspaceSlug: workspace.slug, userId: userOrResponse.id },
    { swarmUrl: swarm.swarmUrl, swarmApiKey: apiToken },
    { actor },
  );

  // Trailing slash matters: the UI's relative `./assets/...` URLs resolve
  // under `/lab/`, and mcp 308s a bare `/lab` there — dropping the `?key=`.
  const url = new URL("/lab/", baseUrl);
  url.searchParams.set("key", body.token);

  return NextResponse.json(
    { url: url.toString(), workspaceSlug: workspace.slug },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
