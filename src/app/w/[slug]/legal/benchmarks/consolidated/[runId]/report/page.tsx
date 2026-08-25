import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { ArrowLeft } from "lucide-react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { db } from "@/lib/db";
import { StakworkRunType } from "@prisma/client";
import { canReadRunReport } from "@/lib/run-report/types";
import { loadRunReport } from "@/lib/run-report/load";
import { ConsolidatedReportView } from "@/components/legal/ConsolidatedReportView";
import { DownloadReportButton } from "@/components/run-report/DownloadReportButton";
import type { ConsolidatedReportProjection } from "@/lib/run-report/types";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { fetchTaskRubricRoster } from "@/services/legal-benchmark-rubrics";
import type { GraphRubric } from "@/lib/harvey-lab/rubric-scoring";

/**
 * Deep-linkable consolidated run report page.
 *
 * Mirrors `runs/[runId]/report/page.tsx` exactly, with two key differences:
 * 1. IDOR WHERE clause restricts to `LEGAL_BENCHMARK_CONSOLIDATED` type — a
 *    RUNNER-type runId must 404, not render. The type gate is in the WHERE
 *    clause, not a post-fetch check, so it cannot be bypassed.
 * 2. Fetches `graphRubrics` for origin-aware contested chip rendering
 *    (CONTESTED vs PRIOR CONTEST) in CriterionDetailTable. Strictly non-fatal:
 *    any failure falls back to the undifferentiated "unknown" chip.
 *
 * `reportUrl` never enters the RSC payload or any client prop: it is not
 * selected below, and is additionally unreachable via the global Prisma omit.
 * Only the sanitized projection crosses the boundary.
 */

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string; runId: string }>;
};

export default async function ConsolidatedReportPage({ params }: PageProps) {
  const { slug, runId } = await params;

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) notFound();

  // resolveWorkspaceAccess reads middleware context off the request, so
  // reconstruct a NextRequest from the incoming headers for this server render.
  const headerList = await headers();
  const request = new NextRequest(
    new URL(
      `/w/${slug}/legal/benchmarks/consolidated/${runId}/report`,
      "http://localhost",
    ),
    { headers: headerList },
  );

  const access = await resolveWorkspaceAccess(request, { slug });
  const member = requireMemberAccess(access);
  if (member instanceof Response) notFound();

  // Same role gate as the sibling run report page: source documents and agent
  // transcripts are not a VIEWER- or STAKEHOLDER-tier artifact.
  if (!canReadRunReport(member.role)) notFound();
  const workspaceId = member.workspaceId;

  // IDOR guard: id, workspaceId, AND type must all match. A RUNNER-type runId
  // must 404 — the type gate is in the WHERE clause, not a post-fetch check.
  const run = await db.stakworkRun.findFirst({
    where: {
      id: runId,
      workspaceId,
      type: StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED,
    },
    // reportUrl IS selected (opting through the global omit) so the server can
    // fetch the bundle. It never enters the RSC payload or any client prop.
    select: { id: true, result: true, reportUrl: true },
  });

  if (!run) notFound();

  const payload = await loadRunReport(run.id, run.reportUrl);

  // Extract taskSlug for the back-link label and the view's task header.
  let taskSlug = "consolidated report";
  try {
    const parsed = run.result
      ? (JSON.parse(run.result) as { taskSlug?: string })
      : null;
    if (parsed?.taskSlug) taskSlug = parsed.taskSlug;
  } catch {
    // Malformed result JSON — the default label is fine.
  }

  // Narrow to ConsolidatedReportProjection if the bundle loaded successfully.
  const projection =
    payload.projection && "consolidated" in payload.projection && payload.projection.consolidated
      ? (payload.projection as ConsolidatedReportProjection)
      : null;

  // Graph rubric roster for origin-aware contested chip rendering
  // (CONTESTED vs PRIOR CONTEST) in the per-criterion detail tables.
  // Strictly non-fatal — any failure falls back to the undifferentiated chip.
  let graphRubrics: GraphRubric[] | null = null;
  if (taskSlug && taskSlug !== "consolidated report") {
    try {
      const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
      if (jarvisConfig) {
        const rosterResult = await fetchTaskRubricRoster(jarvisConfig, taskSlug);
        if (rosterResult.ok) graphRubrics = rosterResult.roster?.rubrics ?? null;
      }
    } catch {
      // Graph unreachable — render without origin distinction.
    }
  }

  return (
    <div
      className="dark flex flex-col h-full bg-black text-white"
      style={{ "--muted-foreground": "oklch(0.75 0 0)" } as React.CSSProperties}
    >
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="flex items-center justify-between mb-5">
          <Link
            href={`/w/${slug}/legal/benchmarks`}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Legal Benchmarks
          </Link>
          <DownloadReportButton
            exportUrl={`/api/workspaces/${slug}/legal/benchmarks/consolidated/${run.id}/report/export`}
          />
        </div>
        <ConsolidatedReportView
          payload={payload}
          projection={projection}
          taskSlug={taskSlug}
          workspaceSlug={slug}
          graphRubrics={graphRubrics}
        />
      </div>
    </div>
  );
}
