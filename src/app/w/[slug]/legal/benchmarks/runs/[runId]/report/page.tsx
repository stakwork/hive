import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { ArrowLeft, Scale } from "lucide-react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { RunReportView } from "@/components/run-report/RunReportView";
import { StakworkRunType } from "@prisma/client";
import { canReadRunReport } from "@/lib/run-report/types";
import { loadRunReport } from "@/lib/run-report/load";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { fetchTaskRubricRoster } from "@/services/legal-benchmark-rubrics";
import type { GraphRubric } from "@/lib/harvey-lab/rubric-scoring";
import { fetchFixSnapshots } from "@/services/legal-benchmark-fix-snapshots";
import type { ProposedFix } from "@/types/legal";

/**
 * Deep-linkable run report page.
 *
 * A SERVER COMPONENT that repeats the API route's authorization in full.
 * Middleware enforces a session, not workspace membership, so a signed-in
 * non-member hitting another workspace's slug would otherwise be unchecked
 * here — the API route's guard does not protect this render path.
 *
 * `reportUrl` never enters the RSC payload or any client prop: it is not
 * selected below, and is additionally unreachable via the global Prisma omit.
 * Only the sanitized projection and the flags cross the boundary.
 */

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string; runId: string }>;
};

export default async function RunReportPage({ params }: PageProps) {
  const { slug, runId } = await params;

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) notFound();

  // resolveWorkspaceAccess reads middleware context off the request, so
  // reconstruct a NextRequest from the incoming headers for this server render.
  const headerList = await headers();
  const request = new NextRequest(
    new URL(`/w/${slug}/legal/benchmarks/runs/${runId}/report`, "http://localhost"),
    { headers: headerList },
  );

  const access = await resolveWorkspaceAccess(request, { slug });
  const member = requireMemberAccess(access);
  if (member instanceof Response) notFound();

  // requireMemberAccess alone admits VIEWER and STAKEHOLDER; source documents
  // and agent transcripts are not a viewer-tier artifact. See
  // RUN_REPORT_ALLOWED_ROLES for why this is a role check rather than the
  // sibling routes' swarm gate.
  if (!canReadRunReport(member.role)) notFound();
  const workspaceId = member.workspaceId;

  // IDOR guard in the WHERE clause — id, workspaceId AND type — so a
  // cross-workspace or wrong-type runId 404s with no post-fetch check.
  const run = await db.stakworkRun.findFirst({
    where: {
      id: runId,
      workspaceId,
      type: { in: [StakworkRunType.LEGAL_BENCHMARK_RUNNER] },
    },
    // reportUrl IS selected (opting through the global omit) so the server can
    // fetch the bundle. It never enters the RSC payload or any client prop.
    select: { id: true, result: true, reportUrl: true },
  });

  if (!run) notFound();

  const payload = await loadRunReport(run.id, run.reportUrl);

  let taskTitle = "Run report";
  let taskSlug: string | null = null;
  try {
    const parsed = run.result
      ? (JSON.parse(run.result) as { taskTitle?: string; taskSlug?: string })
      : null;
    if (parsed?.taskTitle) taskTitle = parsed.taskTitle;
    if (parsed?.taskSlug) taskSlug = parsed.taskSlug;
  } catch {
    // Malformed result JSON — the default title is fine.
  }

  // Graph rubric roster for the task (EvalSet → EvalRequirement) — drives the
  // graph-first score denominator and contested exclusions in the header and
  // ledger. Strictly non-fatal: any failure falls back to bundle-local scoring.
  let graphRubrics: GraphRubric[] | null = null;
  if (taskSlug) {
    try {
      const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
      if (jarvisConfig) {
        const rosterResult = await fetchTaskRubricRoster(jarvisConfig, taskSlug);
        if (rosterResult.ok) graphRubrics = rosterResult.roster?.rubrics ?? null;
      }
    } catch {
      // Graph unreachable — render with bundle-local scoring.
    }
  }

  // Fix snapshots for the task's fix history (graph-sourced, non-fatal).
  let fixSnapshots: ProposedFix[] | null = null;
  if (taskSlug) {
    try {
      const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
      if (jarvisConfig) {
        const evalTriggerRef = (run.result
          ? (JSON.parse(run.result) as Record<string, unknown>)?.eval_trigger_ref_id as string | undefined
          : undefined) ?? undefined;
        fixSnapshots = await fetchFixSnapshots(jarvisConfig, taskSlug, {
          runId: run.id,
          evalTriggerRef,
        });
      }
    } catch {
      // Non-fatal — render without fix snapshots.
    }
  }

  return (
    <div
      className="dark flex flex-col h-full bg-black text-white"
      style={{ "--muted-foreground": "oklch(0.75 0 0)" } as React.CSSProperties}
    >
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <Link
          href={`/w/${slug}/legal/benchmarks`}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground mb-5"
        >
          <ArrowLeft className="h-3 w-3" />
          Legal Benchmarks
        </Link>
        <RunReportView
          payload={payload}
          taskTitle={taskTitle}
          workspaceSlug={slug}
          graphRubrics={graphRubrics}
          fixSnapshots={fixSnapshots}
        />
      </div>
    </div>
  );
}
