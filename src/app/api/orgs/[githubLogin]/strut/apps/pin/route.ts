/**
 * The pin of a strut APP as a TAB of the workspace its swarm is — the app
 * card's "Pin as a tab in <workspace>" (strut `PUT /apps/:name/pin`).
 *
 *   GET  ?swarmId=<Swarm.id>&app=<name>      → { pinned, workspace: { slug, name }, canPin }
 *   POST { swarmId, app, pinned: boolean }   → { pinned, workspace: { slug, name } }
 *
 * The tab appears in the SWARM's workspace, which is not always the one the
 * conversation is in: an app the builder made on a peer (`@openhealth`) is a
 * tab of that workspace. So everything is keyed by the swarm.
 *
 * Gate: `authorizeAppSwarm` (a member of the org, a reader of the swarm's
 * workspace) for both; a pin changes the sidebar for everyone in that
 * workspace, so POST also needs its ADMIN. The swarm key stays here.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { isStrutAppName } from "@/lib/strut-apps";
import { authorizeAppSwarm, readStrutAppPin, setStrutAppPin } from "@/services/strut-apps";
import { validateWorkspaceAccess } from "@/services/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ githubLogin: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin } = await params;

  const query = request.nextUrl.searchParams;
  const app = query.get("app");
  if (!isStrutAppName(app)) return NextResponse.json({ error: "Expected swarmId and app" }, { status: 400 });

  const authorized = await authorizeAppSwarm(userId, githubLogin, query.get("swarmId") ?? "");
  if (!authorized.ok) return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  const { swarm } = authorized;

  const [read, access] = await Promise.all([readStrutAppPin(swarm, app), validateWorkspaceAccess(swarm.workspace.slug, userId)]);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: read.status });
  return NextResponse.json({
    pinned: read.pinned,
    workspace: { slug: swarm.workspace.slug, name: swarm.workspace.name },
    canPin: access.canAdmin,
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin } = await params;

  const body = (await request.json().catch(() => null)) as { swarmId?: unknown; app?: unknown; pinned?: unknown } | null;
  if (!body || typeof body.swarmId !== "string" || !isStrutAppName(body.app) || typeof body.pinned !== "boolean") {
    return NextResponse.json({ error: "Expected { swarmId, app, pinned: boolean }" }, { status: 400 });
  }

  const authorized = await authorizeAppSwarm(userId, githubLogin, body.swarmId);
  if (!authorized.ok) return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  const { swarm } = authorized;

  const access = await validateWorkspaceAccess(swarm.workspace.slug, userId);
  if (!access.canAdmin) {
    return NextResponse.json({ error: `Only an admin of ${swarm.workspace.name} can pin its tabs` }, { status: 403 });
  }

  const set = await setStrutAppPin(swarm, body.app, body.pinned);
  if (!set.ok) return NextResponse.json({ error: set.error }, { status: set.status });
  return NextResponse.json({ pinned: set.pinned, workspace: { slug: swarm.workspace.slug, name: swarm.workspace.name } });
}
