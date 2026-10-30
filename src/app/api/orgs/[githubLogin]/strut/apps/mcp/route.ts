/**
 * POST /api/orgs/[githubLogin]/strut/apps/mcp?swarmId=<Swarm.id>
 *
 * The MCP relay for a strut APP's frame (strut plans/apps.md §7.4): the
 * frame's MCP client (ext-apps' `AppBridge` → the SDK's Streamable HTTP
 * client, `components/strut-app-frame/bridge.ts`) posts here, and Hive
 * forwards the JSON-RPC message AS IT IS to the swarm's `/lab/mcp` with the
 * swarm key as `x-api-token`, the member as `x-strut-actor`, and streams
 * strut's answer back.
 *
 *  1. Session auth; the member must belong to the org and be able to read
 *     the workspace that owns the swarm (`authorizeAppSwarm`) — 404 / 403.
 *  2. ALLOWLIST (`relayRefusal`): `initialize`, `notifications/initialized`,
 *     `tools/list`, and `tools/call` of `step_run` — anything else is
 *     refused with a JSON-RPC error before the swarm is called. The swarm
 *     key opens strut's whole assistant tool set on `/mcp`
 *     (`ask_workflow_builder`, `run_workflow`, …), and strut can gate only
 *     `step_run` by the app's grants, so code a model wrote must never
 *     reach anything else through Hive's credential. Strut checks the
 *     app's token (`step_run`'s `app` argument) and its grants itself.
 *  3. ROLE FLOOR (`relayStepRefusal`): a `step_run` of `run/launch` or
 *     `run/cancel` needs DEVELOPER or above, and a workspace's apps launch
 *     at most 20 runs an hour — a JSON-RPC error the app shows, never
 *     forwarded. Strut knows nothing of Hive roles; this is where they hold.
 *  4. On `initialize` — the member opening the app — Hive also makes sure
 *     the swarm holds the member's standing delegation
 *     (`ensureStrutDelegation`, never throws), so what the app launches is
 *     billed to them as Hive's other strut launches are.
 *
 * GET and DELETE answer 405: strut's door is stateless, so there is no
 * standalone stream to open and no session to end.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { ensureStrutDelegation, resolveStrutActor } from "@/services/bifrost/strut-delegation";
import {
  authorizeAppSwarm,
  MAX_RELAY_BODY_BYTES,
  refusalResponse,
  relayRefusal,
  relayStepRefusal,
  relayToStrutMcp,
} from "@/services/strut-apps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A `run/get { wait }` holds up to 20 s; a step can take longer. */
const RELAY_TIMEOUT_MS = 55_000;
export const maxDuration = 60;

const notAllowed = () =>
  new NextResponse(null, { status: 405, headers: { allow: "POST" } });

export async function POST(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin } = await params;

  const authorized = await authorizeAppSwarm(userId, githubLogin, request.nextUrl.searchParams.get("swarmId") ?? "");
  if (!authorized.ok) return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  const { swarm } = authorized;

  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_RELAY_BODY_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const body = await request.text();
  if (body.length > MAX_RELAY_BODY_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });

  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const refusal = relayRefusal(message) ?? (await relayStepRefusal(message, swarm));
  if (refusal) return refusalResponse(refusal);

  let actor: string;
  try {
    actor = await resolveStrutActor(userId);
  } catch (err) {
    console.warn("[strut-apps] relay: no actor", { userId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Could not name you to the swarm" }, { status: 502 });
  }
  if ((message as { method: string }).method === "initialize") {
    await ensureStrutDelegation(
      { workspaceId: swarm.workspace.id, workspaceSlug: swarm.workspace.slug, userId },
      { swarmUrl: swarm.swarmUrl, swarmApiKey: swarm.swarmApiKey },
      { actor },
    );
  }

  return relayToStrutMcp({
    swarm,
    actor,
    body,
    requestHeaders: request.headers,
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(RELAY_TIMEOUT_MS)]),
  });
}

export async function GET() {
  return notAllowed();
}

export async function DELETE() {
  return notAllowed();
}
