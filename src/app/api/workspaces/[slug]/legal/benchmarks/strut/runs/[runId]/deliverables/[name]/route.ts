/**
 * GET /api/workspaces/:slug/legal/benchmarks/strut/runs/:runId/deliverables/:name
 *     — one deliverable the run produced (`compliance-memo.docx`), as a
 *     download. The name must be one the run's output declared; the path
 *     comes from that output, never from the request.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeBenchmark } from "@/lib/benchmarks/access";
import { fetchStrutArtifact } from "@/services/strut-runs/lab";
import {
  HARVEY_LAB_BENCHMARK_SLUG,
  deliverablesOf,
  findLegalStrutRunRow,
} from "@/services/strut-runs/legal-benchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; runId: string; name: string }> },
) {
  try {
    const { slug, runId, name } = await params;
    const auth = await authorizeBenchmark(request, slug, HARVEY_LAB_BENCHMARK_SLUG);
    if (auth instanceof NextResponse) return auth;

    const row = await findLegalStrutRunRow(auth.member.workspaceId, runId);
    const path = row ? deliverablesOf(row).get(name) : undefined;
    if (!row || !path) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const artifact = await fetchStrutArtifact(row, path);
    if (!artifact) return NextResponse.json({ error: "The run has no such file" }, { status: 404 });

    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return new NextResponse(artifact.body, {
      headers: {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[legal/benchmarks/strut/deliverables] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
