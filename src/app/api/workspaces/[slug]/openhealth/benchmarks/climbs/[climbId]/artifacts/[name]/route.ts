/**
 * GET /api/workspaces/:slug/openhealth/benchmarks/climbs/:climbId/artifacts/:name?iteration=N
 *     — one file of one iteration's benchmark run, by NAME (`problem-list`,
 *     `timeline`, `checklist`). The name picks a fixed file and the
 *     iteration a fixed folder (`iter-N`) under the loop run's own root; no
 *     path is taken from the request, so the answer key next to those files
 *     (`gold.json`) and the improve runs' files cannot be asked for.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import { isClimbIteration } from "@/lib/openhealth-benchmarks/climb";
import {
  isOpenHealthArtifactName,
  OPENHEALTH_ARTIFACTS,
  openHealthIterationWorkdir,
} from "@/lib/openhealth-benchmarks/constants";
import { fetchStrutArtifact } from "@/services/strut-runs/lab";
import { findOpenHealthClimbRow } from "@/services/strut-runs/openhealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; climbId: string; name: string }> },
) {
  try {
    const { slug, climbId, name } = await params;
    const member = await authorizeOpenHealth(request, slug);
    if (member instanceof NextResponse) return member;

    if (!isOpenHealthArtifactName(name)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const raw = request.nextUrl.searchParams.get("iteration");
    const iteration = raw === null || !/^\d+$/.test(raw) ? null : Number(raw);
    if (!isClimbIteration(iteration)) {
      return NextResponse.json({ error: "iteration must be the index of one of the climb's runs" }, { status: 400 });
    }

    const row = await findOpenHealthClimbRow(member.workspaceId, climbId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { file, contentType } = OPENHEALTH_ARTIFACTS[name];
    const artifact = await fetchStrutArtifact(row, `${openHealthIterationWorkdir(iteration)}/${file}`);
    if (!artifact) return NextResponse.json({ error: "The run has no such file" }, { status: 404 });

    return new NextResponse(artifact.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[OpenHealth] climb artifact error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
