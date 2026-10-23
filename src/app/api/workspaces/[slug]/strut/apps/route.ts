/**
 * GET /api/workspaces/[slug]/strut/apps — the apps this workspace's swarm
 * has pinned as TABS (strut `PUT /apps/:name/pin`, the builder's `app/pin`):
 * `{ githubLogin, swarmId, apps: [{ name, title }] }`. The sidebar lists them
 * and the app page (`/w/[slug]/apps/[...name]`) frames one, through the
 * document and relay routes under `api/orgs/[githubLogin]/strut/apps`.
 *
 * A reader of the workspace only, then the app routes' own gate
 * (`authorizeAppSwarm`: a member of the org, the swarm a workspace of it).
 * A workspace with no swarm has no tabs.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { authorizeAppSwarm, listPinnedStrutApps } from "@/services/strut-apps";
import { validateWorkspaceAccess } from "@/services/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { slug } = await params;

  const access = await validateWorkspaceAccess(slug, userId);
  if (!access.hasAccess || !access.canRead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const workspace = await db.workspace.findUnique({
    where: { slug },
    select: { swarm: { select: { id: true } }, sourceControlOrg: { select: { githubLogin: true } } },
  });
  if (!workspace?.swarm || !workspace.sourceControlOrg) return NextResponse.json({ apps: [] });
  const githubLogin = workspace.sourceControlOrg.githubLogin;

  const authorized = await authorizeAppSwarm(userId, githubLogin, workspace.swarm.id);
  if (!authorized.ok) return NextResponse.json({ error: authorized.error }, { status: authorized.status });

  const listed = await listPinnedStrutApps(authorized.swarm);
  if (!listed.ok) return NextResponse.json({ error: listed.error }, { status: listed.status });
  return NextResponse.json({ githubLogin, swarmId: workspace.swarm.id, apps: listed.apps });
}
