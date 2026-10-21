/**
 * GET /api/workspaces/:slug/benchmarks/:benchmarkSlug/app — where a benchmark's
 * strut APP is (`Benchmark.app`): the workspace's org and its own swarm,
 * which the app frame reads the document and relays the calls through
 * (`api/orgs/[githubLogin]/strut/apps/*`, which authorize again). 404 for an
 * entry with no app; 409 when the workspace has no swarm or no org.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeBenchmark } from "@/lib/benchmarks/access";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; benchmarkSlug: string }> },
) {
  const { slug, benchmarkSlug } = await params;
  const auth = await authorizeBenchmark(request, slug, benchmarkSlug);
  if (auth instanceof NextResponse) return auth;
  const { app } = auth.benchmark;
  if (!app) return NextResponse.json({ error: "This benchmark has no app" }, { status: 404 });

  const workspace = await db.workspace.findUnique({
    where: { id: auth.member.workspaceId },
    select: { swarm: { select: { id: true } }, sourceControlOrg: { select: { githubLogin: true } } },
  });
  if (!workspace?.swarm) return NextResponse.json({ error: "This workspace has no swarm" }, { status: 409 });
  if (!workspace.sourceControlOrg) return NextResponse.json({ error: "This workspace has no org" }, { status: 409 });

  return NextResponse.json({
    githubLogin: workspace.sourceControlOrg.githubLogin,
    swarmId: workspace.swarm.id,
    app: { name: app.name, ...(app.version ? { version: app.version } : {}) },
  });
}
