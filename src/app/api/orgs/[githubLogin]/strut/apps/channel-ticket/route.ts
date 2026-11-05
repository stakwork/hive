/**
 * POST /api/orgs/[githubLogin]/strut/apps/channel-ticket?swarmId=<Swarm.id>
 * body { app, version? } — no version: the app's live one, read here
 *
 * Mints a ticket for a strut app CHANNEL socket (strut#487). A Vercel route
 * cannot hold a WebSocket, so this only asks the swarm's strut for a ticket
 * (`POST {lab}/apps/<name>/channel-ticket`, swarm key as `x-api-token`, the
 * member as `x-strut-actor`) and answers `{ ticket, exp, url }`; the PAGE
 * opens `url?ticket=…` straight to strut. A ticket lives one minute, so the
 * page mints one per connect, reconnects included — never cached.
 *
 * Same session auth and `authorizeAppSwarm` as the MCP relay (404 / 403).
 * Role floor: READ access, what `authorizeAppSwarm` gives — in strut a
 * channel needs only read access, so no further Hive role is asked for.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveStrutActor } from "@/services/bifrost/strut-delegation";
import { authorizeAppSwarm, readStrutAppVersions } from "@/services/strut-apps";
import { isStrutAppName, isStrutAppVersion, strutChannelSocketUrl } from "@/lib/strut-apps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKET_TIMEOUT_MS = 15_000;
const NO_STORE = { "cache-control": "no-store" };

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin } = await params;

  const authorized = await authorizeAppSwarm(userId, githubLogin, request.nextUrl.searchParams.get("swarmId") ?? "");
  if (!authorized.ok) return json({ error: authorized.error }, authorized.status);
  const { swarm } = authorized;

  let body: { app?: unknown; version?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const app = body?.app;
  if (!isStrutAppName(app)) return json({ error: "app is required" }, 400);
  let version: string;
  if (body?.version === undefined || body.version === null) {
    // The frame was opened without one: strut serves the live version, so that is the room.
    const versions = await readStrutAppVersions(swarm, app);
    if (!versions.ok) return json({ error: versions.error }, versions.status);
    version = versions.live;
  } else if (isStrutAppVersion(body.version)) {
    version = body.version;
  } else {
    return json({ error: "version is not valid" }, 400);
  }

  let actor: string;
  try {
    actor = await resolveStrutActor(userId);
  } catch (err) {
    console.warn("[strut-apps] channel-ticket: no actor", { userId, error: err instanceof Error ? err.message : String(err) });
    return json({ error: "Could not name you to the swarm" }, 502);
  }

  let res: Response;
  try {
    res = await fetch(`${swarm.labBase}/apps/${encodeURIComponent(app)}/channel-ticket`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-token": swarm.swarmApiKey, "x-strut-actor": actor },
      body: JSON.stringify({ version }),
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(TICKET_TIMEOUT_MS)]),
    });
  } catch {
    return json({ error: "The swarm's strut server could not be reached" }, 502);
  }
  if (res.status === 400) return json({ error: "The app or version is not valid for channels" }, 400);
  if (res.status === 403) return json({ error: "Channels are not available to you for this app" }, 403);
  if (res.status === 404) return json({ error: "App not found" }, 404);
  if (!res.ok) return json({ error: "The swarm's strut server refused the ticket" }, 502);

  const answer = (await res.json().catch(() => null)) as { ticket?: unknown; exp?: unknown } | null;
  if (!answer || typeof answer.ticket !== "string" || !answer.ticket) return json({ error: "The swarm's strut server sent no ticket" }, 502);
  return json({ ticket: answer.ticket, exp: answer.exp, url: strutChannelSocketUrl(swarm.labBase) });
}
