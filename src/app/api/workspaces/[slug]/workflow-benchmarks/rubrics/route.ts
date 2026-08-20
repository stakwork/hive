import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { fetchTaskRubricRoster } from "@/services/legal-benchmark-rubrics";
import { isDevelopmentMode } from "@/lib/runtime";
import type { GraphRubric } from "@/lib/harvey-lab/rubric-scoring";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

const ALLOWED_SLUGS = ["stakwork"];

function buildMockRoster(taskSlug: string): { evalSetRefId: string; rubrics: GraphRubric[] } {
  const rubrics: GraphRubric[] = [
    { ref_id: `mock-req-${taskSlug}-WFB-001`, id: "WFB-001", name: "Step enumeration completeness", contested: false },
    { ref_id: `mock-req-${taskSlug}-WFB-002`, id: "WFB-002", name: "Step purpose accuracy", contested: false },
    { ref_id: `mock-req-${taskSlug}-WFB-003`, id: "WFB-003", name: "Final output identification", contested: false },
    { ref_id: `mock-req-${taskSlug}-WFB-004`, id: "WFB-004", name: "Clarity and conciseness", contested: false },
  ];
  return { evalSetRefId: `mock-evalset-${taskSlug}`, rubrics };
}

/**
 * GET /api/workspaces/[slug]/workflow-benchmarks/rubrics?taskSlug=...
 *
 * Returns the graph rubric roster for a workflow benchmark task.
 * Returns 200 with data: null when no EvalSet exists in the graph.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;

    if (!ALLOWED_SLUGS.includes(slug) && !isDevelopmentMode()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const access = await resolveWorkspaceAccess(request, { slug });
    const readable = requireReadAccess(access);
    if (readable instanceof NextResponse) return readable;

    const taskSlug = new URL(request.url).searchParams.get("taskSlug")?.trim();
    if (!taskSlug) {
      return NextResponse.json({ error: "taskSlug query param is required" }, { status: 400 });
    }

    if (process.env.USE_MOCKS === "true") {
      const roster = buildMockRoster(taskSlug);
      return NextResponse.json({
        success: true,
        data: {
          ...roster,
          total: roster.rubrics.length,
          contested: 0,
        },
      });
    }

    const jarvisConfig = await getJarvisConfigForWorkspace(readable.workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ error: "Swarm not configured" }, { status: 400 });
    }

    const result = await fetchTaskRubricRoster(jarvisConfig, taskSlug);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Failed to fetch rubrics from graph" },
        { status: 502 },
      );
    }

    if (!result.roster) {
      return NextResponse.json({ success: true, data: null });
    }

    const { evalSetRefId, rubrics } = result.roster;
    return NextResponse.json({
      success: true,
      data: {
        evalSetRefId,
        rubrics,
        total: rubrics.length,
        contested: rubrics.filter((r) => r.contested).length,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
