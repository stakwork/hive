import { NextRequest, NextResponse } from "next/server";

import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { ensureStrutDelegation } from "@/services/bifrost/strut-delegation";
import { ensureStrutHiveKey } from "@/services/strut-hive-key";
import { resolveStrutTarget } from "@/services/strut-target";
import { getBaseUrl } from "@/lib/utils";

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
 *  1. Auth, then resolve the org's strut (`resolveStrutTarget`, purpose
 *     "embed": the default workspace's swarm first — the same swarm the
 *     Gateway view embeds).
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
 * standing delegation for that user (`ensureStrutDelegation`). It also
 * makes sure that strut holds the org's `HIVE_API_KEY` + `HIVE_URL`
 * deployment secrets (`ensureStrutHiveKey`). A failed push never blocks
 * the embed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  const resolved = await resolveStrutTarget({
    purpose: "embed",
    orgGithubLogin: githubLogin,
    userId: userOrResponse.id,
  });
  if (!resolved.ok) {
    if (resolved.error.type === "DECRYPT_FAILED") {
      return NextResponse.json(
        { error: `Failed to decrypt swarmApiKey: ${resolved.error.message}` },
        { status: 500 },
      );
    }
    if (resolved.error.type === "SWARM_NOT_CONFIGURED") {
      return NextResponse.json(
        { error: "Swarm is missing swarmUrl or swarmApiKey" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "No swarm configured for any workspace in this org" },
      { status: 404 },
    );
  }
  const { target } = resolved;
  const apiToken = target.swarmApiKey;
  const baseUrl = target.mcpBase;
  const actor = target.actor;

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

  // Neither throws: a failed push is logged and the embed goes ahead.
  await Promise.all([
    ensureStrutDelegation(
      { workspaceId: target.workspaceId, workspaceSlug: target.workspaceSlug, userId: userOrResponse.id },
      { swarmUrl: target.swarmUrl, swarmApiKey: apiToken },
      { actor },
    ),
    ensureStrutHiveKey(
      {
        swarmId: target.swarmId,
        workspaceId: target.workspaceId,
        orgId: target.orgId,
        lab: { labBase: target.labBase, swarmApiKey: apiToken },
      },
      { publicBaseUrl: getBaseUrl(request.headers.get("host")), userId: userOrResponse.id },
    ),
  ]);

  // Trailing slash matters: the UI's relative `./assets/...` URLs resolve
  // under `/lab/`, and mcp 308s a bare `/lab` there — dropping the `?key=`.
  const url = new URL("/lab/", baseUrl);
  url.searchParams.set("key", body.token);

  return NextResponse.json(
    { url: url.toString(), workspaceSlug: target.workspaceSlug },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
