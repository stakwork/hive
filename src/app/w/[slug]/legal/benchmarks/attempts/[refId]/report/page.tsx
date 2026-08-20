import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { ArrowLeft } from "lucide-react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { RunReportView } from "@/components/run-report/RunReportView";
import { canReadRunReport } from "@/lib/run-report/types";
import { loadRunReport } from "@/lib/run-report/load";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { readNodeByRef } from "@/services/swarm/api/nodes";
import { fetchTaskRubricRoster } from "@/services/legal-benchmark-rubrics";
import type { GraphRubric } from "@/lib/harvey-lab/rubric-scoring";

/**
 * Deep-linkable report page for a graph-only recursion attempt.
 *
 * Recursion re-runs are scored by the external Stakwork workflow and land only
 * as EvalTriggerOutput nodes — there is no StakworkRun row, so the runs report
 * page cannot serve them. This page mirrors it exactly, sourcing `report_url`
 * from the node instead of the row:
 *
 *  - Same auth: session → member access → canReadRunReport role gate.
 *  - Same bundle pipeline: `loadRunReport` fetches the S3 bundle SERVER-SIDE
 *    through `fetchReportBundle`, whose URL allowlist is the live SSRF guard —
 *    the raw bundle URL never reaches the client, only the sanitized
 *    projection does.
 *  - The IDOR-guard analogue of the runs page's `type IN (...)` WHERE clause:
 *    the node is fetched from the authenticated workspace's own swarm and must
 *    actually be an EvalTriggerOutput, or the page 404s.
 */

export const dynamic = "force-dynamic";

const TASK_SLUG_RE = /^[a-z0-9_\-/]+$/i;

type PageProps = {
  params: Promise<{ slug: string; refId: string }>;
  searchParams: Promise<{ task?: string }>;
};

export default async function AttemptReportPage({ params, searchParams }: PageProps) {
  const { slug, refId } = await params;
  const { task } = await searchParams;

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) notFound();

  // resolveWorkspaceAccess reads middleware context off the request, so
  // reconstruct a NextRequest from the incoming headers for this server render.
  const headerList = await headers();
  const request = new NextRequest(
    new URL(`/w/${slug}/legal/benchmarks/attempts/${refId}/report`, "http://localhost"),
    { headers: headerList },
  );

  const access = await resolveWorkspaceAccess(request, { slug });
  const member = requireMemberAccess(access);
  if (member instanceof Response) notFound();

  // requireMemberAccess alone admits VIEWER and STAKEHOLDER; report bundles
  // carry converted legal documents and agent transcripts, which are not a
  // viewer-tier artifact. Same gate as the runs report page.
  if (!canReadRunReport(member.role)) notFound();
  const workspaceId = member.workspaceId;

  const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
  if (!jarvisConfig) notFound();

  // Node fetch is scoped to the authenticated workspace's own swarm config, so
  // a foreign ref_id cannot cross workspaces. The type check below rejects any
  // node that is not an EvalTriggerOutput — without it, any graph node with a
  // report_url-shaped property would become fetchable through this page.
  const node = await readNodeByRef(jarvisConfig, refId);
  if (!node.success) notFound();
  if ((node.node_type ?? "").toLowerCase() !== "evaltriggeroutput") notFound();

  const rawReportUrl = node.properties?.report_url;
  const reportUrl = typeof rawReportUrl === "string" && rawReportUrl.trim() !== ""
    ? rawReportUrl.trim()
    : null;

  // Fetched and sanitized server-side; loadRunReport renders guard rejections
  // and missing bundles as in-page states rather than throwing.
  const payload = await loadRunReport(refId, reportUrl);

  // Optional task slug from the query string — display + rubric enrichment
  // only, never a fetch input beyond the workspace's own graph. Invalid values
  // are ignored rather than fatal.
  const taskSlug = task && TASK_SLUG_RE.test(task) ? task : null;
  const taskTitle = taskSlug ?? "Attempt report";

  // Graph rubric roster for the task (EvalSet → EvalRequirement) — drives the
  // graph-first score denominator and contested exclusions, matching the runs
  // report page. Strictly non-fatal: any failure falls back to bundle-local
  // scoring.
  let graphRubrics: GraphRubric[] | null = null;
  if (taskSlug) {
    try {
      const rosterResult = await fetchTaskRubricRoster(jarvisConfig, taskSlug);
      if (rosterResult.ok) graphRubrics = rosterResult.roster?.rubrics ?? null;
    } catch {
      // Graph unreachable — render with bundle-local scoring.
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
        />
      </div>
    </div>
  );
}
