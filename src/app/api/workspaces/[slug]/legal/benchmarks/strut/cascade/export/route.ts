/**
 * GET /api/workspaces/:slug/legal/benchmarks/strut/cascade/export?runId=
 *     — one self-contained HTML file of a `harvey-lab-run` run's trace (the
 *     strut twin of `legal/benchmarks/cascade/export`), assembled from the
 *     run's strut log as the Traces panel reads it, with every Concept the
 *     run read embedded so its peek opens offline. Gated like the other
 *     strut cascade routes, plus the export's per-user limit, since one
 *     export reads every agent's transcript and up to 200 nodes.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitSafe } from "@/lib/benchmarks/access";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { assembleCascadeExportFrom } from "@/lib/legal-cascade/export/assemble";
import { CascadeBundleMissingError } from "@/lib/legal-cascade/export/offline-html";
import { CASCADE_EXPORT_NO_STORE as NO_STORE, cascadeExportResponse } from "@/lib/legal-cascade/export/response";
import { logger } from "@/lib/logger";
import {
  resolveStrutTraceAccess,
  strutTraceExportSource,
  StrutTraceUnavailableError,
} from "@/services/strut-runs/legal-trace";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const LOG_SERVICE = "legal-cascade/strut-export";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const access = await resolveStrutTraceAccess(request, (await params).slug);
    if (access instanceof NextResponse) return access;
    const { row, member } = access;

    const limit = await checkRateLimitSafe(`legal-cascade-export:${member.userId}`, 10, 60);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: limit.retryAfter },
        { status: 429, headers: NO_STORE },
      );
    }

    // The peeks read the workspace's graph, as the live panel's do. Without
    // swarm access the file still holds the whole trace, with no peeks.
    const swarm = await getWorkspaceSwarmAccess(member.slug, member.userId);
    const peekAccess = swarm.success ? { swarmName: swarm.data.swarmName, swarmApiKey: swarm.data.swarmApiKey } : null;

    const payload = await assembleCascadeExportFrom(strutTraceExportSource(row), { runId: row.id, peekAccess });
    return cascadeExportResponse(payload, LOG_SERVICE);
  } catch (error) {
    logger.error("Cascade export failed", LOG_SERVICE, { error: String(error) });
    if (error instanceof StrutTraceUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 502, headers: NO_STORE });
    }
    // A document without its bundle is a blank page — refuse to serve one.
    if (error instanceof CascadeBundleMissingError) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({ error: "Failed to build trace export" }, { status: 502, headers: NO_STORE });
  }
}
