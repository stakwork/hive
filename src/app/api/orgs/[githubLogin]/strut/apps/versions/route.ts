/**
 * An app's VERSIONS and RELEASES — the version picker on an app's card,
 * "Make vN live", and holding the app (strut `GET /apps/:name/versions`,
 * `PUT /apps/:name/active`; strut `plans/app-releases.md`).
 *
 *   GET  ?swarmId=<Swarm.id>&app=<name>
 *        → { live, versions: [{ version, createdAt? }], holdable, release, releases, behind, canSetLive }
 *   POST { swarmId, app, version: "vN" }       promote: a release of vN, made live (the app held)
 *   POST { swarmId, app, release: "rN" }       roll back (or forward) to a release
 *   POST { swarmId, app, version: "latest" }   follow latest again
 *        → { live, release }
 *
 * `live` is the version strut serves when none is named, what every card
 * and tab of the app shows; `release` is the live release's id, null while
 * the app follows latest. `holdable` is false on a strut without releases:
 * no `release`, `releases` or `behind`, and only a version can be made live.
 *
 * Viewing another version is the reader's own; making one live changes the
 * app for everyone, so POST needs an ADMIN of the swarm's workspace — the
 * same rule as pinning it as a tab. Gate: `authorizeAppSwarm` for both.
 * The swarm key stays here.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { isStrutAppName, isStrutAppRelease, isStrutAppVersion } from "@/lib/strut-apps";
import { resolveStrutActor } from "@/services/bifrost/strut-delegation";
import { authorizeAppSwarm, readStrutAppVersions, setStrutAppLive, type StrutAppLiveTarget } from "@/services/strut-apps";
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
  const { ok: _ok, ...versions } = read;
  return NextResponse.json({ ...versions, canSetLive: access.canAdmin });
}

/** Exactly one of `version` (`vN` or `latest`) and `release` (`rN`). */
function liveTarget(body: { version?: unknown; release?: unknown }): StrutAppLiveTarget | null {
  if (body.version !== undefined && body.release !== undefined) return null;
  if (isStrutAppVersion(body.version) || body.version === "latest") return { version: body.version };
  if (isStrutAppRelease(body.release)) return { release: body.release };
  return null;
}

export async function POST(request: NextRequest, { params }: Params) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin } = await params;

  const body = (await request.json().catch(() => null)) as { swarmId?: unknown; app?: unknown; version?: unknown; release?: unknown } | null;
  const target = body ? liveTarget(body) : null;
  if (!body || typeof body.swarmId !== "string" || !isStrutAppName(body.app) || !target) {
    return NextResponse.json({ error: 'Expected { swarmId, app } and one of version ("vN" or "latest") or release ("rN")' }, { status: 400 });
  }

  const authorized = await authorizeAppSwarm(userId, githubLogin, body.swarmId);
  if (!authorized.ok) return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  const { swarm } = authorized;

  const access = await validateWorkspaceAccess(swarm.workspace.slug, userId);
  if (!access.canAdmin) {
    return NextResponse.json({ error: `Only an admin of ${swarm.workspace.name} can change which version is live` }, { status: 403 });
  }

  // Strut records who made a release live; without a name it records none.
  const actor = await resolveStrutActor(userId).catch(() => undefined);
  const set = await setStrutAppLive(swarm, body.app, target, { actor });
  if (!set.ok) return NextResponse.json({ error: set.error }, { status: set.status });
  return NextResponse.json({ live: set.live, release: set.release });
}
