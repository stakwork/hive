/**
 * GET /api/orgs/[githubLogin]/strut/apps/document?swarmId=<Swarm.id>&app=<name>[&version=vN]
 *
 * A workspace app, its active version unless one is named. (A job's app, a
 * directory in a job's, is retired on strut's side: strut
 * plans/chained-orchestrators.md §6.)
 *
 * The document of a strut APP, for the app frame (`components/strut-app-frame`),
 * read from the swarm through Hive's own origin behind Hive's session.
 *
 *  1. Session auth (protected middleware default); the caller must belong
 *     to the org (404 otherwise), the swarm to a workspace of it the caller
 *     can read (403) — `authorizeAppSwarm`.
 *  2. With the swarm key (decrypted here, never sent to the browser): list
 *     the app's files, which mints its file token, then read
 *     `dist/index.html?t=<token>` — strut writes that token into the
 *     document. The token is the app's, worth its files only and its
 *     identity to `step_run`; it is meant to be in the page.
 *
 * The bytes go back as an opaque download (`htmlBodyProxyHeaders`): a
 * cookie-authenticated HTML response on Hive's origin would be stored XSS
 * the moment something navigated to it. The frame fetches them and frames
 * them as `srcdoc` in a sandbox with scripts only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { isStrutAppName, isStrutAppVersion } from "@/lib/strut-apps";
import { htmlBodyProxyHeaders } from "@/lib/utils/html-body-proxy";
import { authorizeAppSwarm, fetchStrutAppDocument, type StrutAppAddress } from "@/services/strut-apps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which app the query names, or null when it names none well. */
function addressOf(query: URLSearchParams): StrutAppAddress | null {
  const app = query.get("app");
  const version = query.get("version") || undefined;
  if (app === null || !isStrutAppName(app) || (version !== undefined && !isStrutAppVersion(version))) return null;
  return { app, ...(version ? { version } : {}) };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin } = await params;

  const query = request.nextUrl.searchParams;
  const at = addressOf(query);
  if (!at) {
    return NextResponse.json({ error: "Expected swarmId with app (and version)" }, { status: 400 });
  }

  const authorized = await authorizeAppSwarm(userId, githubLogin, query.get("swarmId") ?? "");
  if (!authorized.ok) return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  const { swarm } = authorized;

  const doc = await fetchStrutAppDocument(swarm, at);
  if (!doc.ok) return NextResponse.json({ error: doc.error }, { status: doc.status });
  const stem = at.app.split("/").pop()!;
  return new NextResponse(doc.html, { status: 200, headers: htmlBodyProxyHeaders(stem) });
}
