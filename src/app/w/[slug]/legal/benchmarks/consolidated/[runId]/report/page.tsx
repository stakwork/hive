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

/**
 * Deep-linkable consolidated report page.
 *
 * Mirrors `runs/[runId]/report/page.tsx` exactly, with two differences:
 * 1. IDOR WHERE clause restricts to `type: LEGAL_BENCHMARK_CONSOLIDATED` only —
 *    a RUNNER-type runId for the correct workspace must 404, not render.
 * 2. Renders ConsolidatedReportView instead of RunReportView.
 *
 * Authorization and bundle-fetch patterns are identical to the sibling page.
 * `reportUrl` never enters the RSC payload or any client prop.
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
    new URL(`/w/${slug}/legal/benchmarks/consolidated/${runId}/report`, "http://localhost"),
    { headers: headerList },
  );

  const access = await resolveWorkspaceAccess(request, { slug });
  const member = requireMemberAccess(access);
  if (member instanceof Response) notFound();

  // requireMemberAccess alone admits VIEWER and STAKEHOLDER; consolidated report
  // bundles carry converted legal source documents and agent transcripts. Same
  // role gate as the sibling runs report page.
  if (!canReadRunReport(member.role)) notFound();
  const workspaceId = member.workspaceId;

  // IDOR guard: id, workspaceId AND type=CONSOLIDATED in the WHERE clause.
  // A runId that belongs to the correct workspace but is a RUNNER type must 404.
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

  let taskTitle = "Consolidated Report";
  try {
    const parsed = run.result
      ? (JSON.parse(run.result) as { taskTitle?: string; taskSlug?: string })
      : null;
    if (parsed?.taskTitle) taskTitle = parsed.taskTitle;
    else if (parsed?.taskSlug) taskTitle = `Consolidated Report — ${parsed.taskSlug}`;
  } catch {
    // Malformed result JSON — the default title is fine.
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
        <ConsolidatedReportView
          payload={payload}
          taskTitle={taskTitle}
          workspaceSlug={slug}
        />
      </div>
    </div>
  );
}
