import { NextRequest, NextResponse } from "next/server";

import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { deriveBifrostBaseUrl } from "@/services/bifrost/resolve";
import { BIFROST_HTTP_TIMEOUT_MS } from "@/services/bifrost/constants";

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

  // Find any workspace in this org the user can access that already
  // has a swarm with a URL + api key. `findFirst` rather than
  // `findMany` because the gateway UI is shown once per org-page
  // visit, not per-workspace — first match wins.
  const workspace = await db.workspace.findFirst({
    where: {
      deleted: false,
      sourceControlOrg: { githubLogin },
      OR: [
        { ownerId: userId },
        { members: { some: { userId, leftAt: null } } },
      ],
      swarm: { isNot: null },
    },
    include: { swarm: true },
  });

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

  let provisioningToken: string;
  try {
    provisioningToken = EncryptionService.getInstance().decryptField(
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

  const baseUrl = deriveBifrostBaseUrl(swarm.swarmUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BIFROST_HTTP_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/_plugin/auth/ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provisioningToken}` },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = (err as Error).name === "AbortError"
      ? `gateway mint timed out after ${BIFROST_HTTP_TIMEOUT_MS}ms`
      : `gateway mint failed: ${err instanceof Error ? err.message : String(err)}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return NextResponse.json(
      { error: `gateway mint returned ${resp.status}: ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const body = (await resp.json()) as { ticket?: string };
  if (!body?.ticket) {
    return NextResponse.json(
      { error: "gateway mint returned no ticket" },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: baseUrl, ticket: body.ticket });
}
