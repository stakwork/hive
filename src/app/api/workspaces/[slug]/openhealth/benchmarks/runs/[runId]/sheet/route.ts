import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { resolveOpenHealthStrut, fetchOwnedRun, OPENHEALTH_WORKFLOWS } from "@/lib/openhealth-benchmarks/strut-client";
import { OPENHEALTH_SHEET_FIELD, OPENHEALTH_SHEET_ARTIFACT_BASENAME } from "@/lib/openhealth-benchmarks/contract";
import { strutFetch } from "@/lib/strut/fetch";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

const LOG_TAG = "openhealth-benchmarks";

type RouteParams = { params: Promise<{ slug: string; runId: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fully normalize a path-like string (repeated percent-decoding, backslash
 * -> forward slash, strip NUL, collapse trailing `.`/`/`) and reject
 * anything that still isn't EXACTLY the one allowlisted basename, or that
 * contains "gold"/"ground_truth" anywhere along the way.
 */
function isAllowedSheetBasename(candidate: string): boolean {
  let decoded = candidate;
  for (let i = 0; i < 5; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  decoded = decoded.replace(/\\/g, "/").replace(/\0/g, "");
  while (decoded.endsWith(".") || decoded.endsWith("/")) {
    decoded = decoded.slice(0, -1);
  }
  const lower = decoded.toLowerCase();
  if (lower.includes("gold") || lower.includes("ground_truth")) return false;
  if (lower.includes("/") || lower.includes("..")) return false;
  return decoded === OPENHEALTH_SHEET_ARTIFACT_BASENAME;
}

/**
 * GET /api/workspaces/[slug]/openhealth/benchmarks/runs/[runId]/sheet
 *
 * Replaces any general artifact proxy: this is the ONE fixed-name route
 * that may ever serve a run's results Sheet. `fetchOwnedRun` first. The
 * server rebuilds the artifact path from an allowlisted basename under the
 * run's own workdir — the client supplies no path at all.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug, runId } = await params;
    const resolved = await resolveOpenHealthStrut(request, slug, { write: false });
    if (!resolved.ok) return resolved.response;
    const { target, userId } = resolved;

    const owned = await fetchOwnedRun(target, runId);
    if (!owned.ok) return owned.response;

    const output = isRecord(owned.summary.output) ? owned.summary.output : {};
    const sheet = output[OPENHEALTH_SHEET_FIELD];

    // An external URL Sheet has no artifact route — the URL is surfaced
    // directly in `projectRunSummary` instead.
    if (typeof sheet === "string" && /^https:\/\//i.test(sheet)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (isRecord(sheet) && typeof sheet.url === "string") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const basename = OPENHEALTH_SHEET_ARTIFACT_BASENAME;
    if (!isAllowedSheetBasename(basename)) {
      // Unreachable given the constant above, but keeps the allowlist check
      // load-bearing rather than decorative.
      logger.warn("[openhealth/benchmarks/runs/sheet] blocked path", LOG_TAG, { userId, runId });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const input = isRecord(owned.summary.input) ? owned.summary.input : {};
    const gtId = String(input.gtId ?? output.gtId ?? "");
    const workdir = `gt-${gtId}`;
    const artifactPath = `${workdir}/${basename}`;

    let artifactRes: Response;
    try {
      artifactRes = await strutFetch(
        target,
        `/workflows/${encodeURIComponent(OPENHEALTH_WORKFLOWS.run)}/runs/${encodeURIComponent(runId)}/artifact?path=${encodeURIComponent(artifactPath)}`,
        { method: "GET" },
      );
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (artifactRes.status === 501 || artifactRes.status === 404 || !artifactRes.ok || !artifactRes.body) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return new Response(artifactRes.body, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${basename}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("[openhealth/benchmarks/runs/[runId]/sheet GET] Unexpected error", LOG_TAG, {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
