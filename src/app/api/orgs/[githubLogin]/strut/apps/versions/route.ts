/**
 * An app's VERSIONS — the version picker on an app's card, and its
 * "Make vN live" (strut `GET /apps/:name/versions`, `PUT /apps/:name/active`).
 *
 *   GET  ?swarmId=<Swarm.id>&app=<name>       → { live, versions: [{ version, createdAt? }], canSetLive }
 *   POST { swarmId, app, version }            → { live }
 *
 * `live` is the version strut serves when none is named, what every card
 * and tab of the app shows. Viewing another version is the reader's own;
 * making it live changes the app for everyone, so POST needs an ADMIN of the
 * swarm's workspace — the same rule as pinning it as a tab. Gate:
 * `authorizeAppSwarm` for both. The swarm key stays here.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { isStrutAppName, isStrutAppVersion } from "@/lib/strut-apps";
import { authorizeAppSwarm, readStrutAppVersions, setStrutAppLive } from "@/services/strut-apps";
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

  const [read, access] = await Promise.all([readStrutAppVersions(swarm, app), validateWorkspaceAccess(swarm.workspace.slug, userId)]);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: read.status });
  return NextResponse.json({ live: read.live, versions: read.versions, canSetLive: access.canAdmin });
}

export async function POST(request: NextRequest, { params }: Params) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin } = await params;

  const body = (await request.json().catch(() => null)) as { swarmId?: unknown; app?: unknown; version?: unknown } | null;
  if (!body || typeof body.swarmId !== "string" || !isStrutAppName(body.app) || !isStrutAppVersion(body.version)) {
    return NextResponse.json({ error: "Expected { swarmId, app, version }" }, { status: 400 });
  }

  const authorized = await authorizeAppSwarm(userId, githubLogin, body.swarmId);
  if (!authorized.ok) return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  const { swarm } = authorized;

  const access = await validateWorkspaceAccess(swarm.workspace.slug, userId);
  if (!access.canAdmin) {
    return NextResponse.json({ error: `Only an admin of ${swarm.workspace.name} can change which version is live` }, { status: 403 });
  }

  const set = await setStrutAppLive(swarm, body.app, body.version);
  if (!set.ok) return NextResponse.json({ error: set.error }, { status: set.status });
  return NextResponse.json({ live: set.live });
}
