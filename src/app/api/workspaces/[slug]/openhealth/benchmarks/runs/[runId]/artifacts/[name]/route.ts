/**
 * GET /api/workspaces/:slug/openhealth/benchmarks/runs/:runId/artifacts/:name
 *     — one of the run's files, by NAME (`problem-list`, `timeline`,
 *     `checklist`). The name picks a fixed file under the run's own folder;
 *     no path is taken from the request, so the answer key next to those
 *     files (`gold.json`) cannot be asked for.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import {
  isOpenHealthArtifactName,
  OPENHEALTH_ARTIFACTS,
  openHealthWorkdir,
} from "@/lib/openhealth-benchmarks/constants";
import { fetchStrutArtifact } from "@/services/strut-runs/lab";
import { findOpenHealthRunRow } from "@/services/strut-runs/openhealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; runId: string; name: string }> },
) {
  try {
    const { slug, runId, name } = await params;
    const member = await authorizeOpenHealth(request, slug);
    if (member instanceof NextResponse) return member;

    if (!isOpenHealthArtifactName(name)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const row = await findOpenHealthRunRow(member.workspaceId, runId);
    const gtId = (row?.input as { gtId?: unknown } | null)?.gtId;
    if (!row || typeof gtId !== "number" || !Number.isInteger(gtId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { file, contentType } = OPENHEALTH_ARTIFACTS[name];
    const artifact = await fetchStrutArtifact(row, `${openHealthWorkdir(gtId)}/${file}`);
    if (!artifact) return NextResponse.json({ error: "The run has no such file" }, { status: 404 });

    return new NextResponse(artifact.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[OpenHealth] run artifact error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
