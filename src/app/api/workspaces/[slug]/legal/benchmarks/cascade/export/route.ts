import { NextRequest, NextResponse } from "next/server";
import { resolveCascadeAccess } from "@/lib/legal-cascade/server";
import { assembleCascadeExport } from "@/lib/legal-cascade/export/assemble";
import {
  assembleCascadeOfflineHtml,
  CascadeBundleMissingError,
} from "@/lib/legal-cascade/export/offline-html";
import { buildContentDisposition } from "@/lib/run-report/export/content-disposition";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";
// Every session's turn pages plus up to 200 concept peeks — well past the
// default function budget on a large run.
export const maxDuration = 60;

type RouteParams = { params: Promise<{ slug: string }> };

const LOG_SERVICE = "legal-cascade/export";
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/cascade/export?runId=...
 *
 * One self-contained HTML file of the run's trace: the same cascade UI the
 * Traces panel shows, with every Concept the run read embedded so its peek
 * opens offline. Auth, the openlaw gate, rate limiting and the IDOR-guarded
 * run lookup are the cascade proxy routes' own (resolveCascadeAccess); this
 * route adds a stricter per-user limit because one export fans out into
 * many upstream calls.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await resolveCascadeAccess(request, params);
    if (access instanceof NextResponse) return access;

    const limit = await checkRateLimit(`legal-cascade-export:${access.userId}`, 10, 60);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: limit.retryAfter },
        { status: 429, headers: NO_STORE },
      );
    }

    const payload = await assembleCascadeExport(access);
    const filename = `run-trace-${access.runId}.html`;
    const html = assembleCascadeOfflineHtml(payload, `Run trace · ${access.runId}`);
    const bytes = Buffer.byteLength(html, "utf8");

    logger.info("Cascade export built", LOG_SERVICE, {
      runId: access.runId,
      agents: payload.model.summary.agents,
      peeks: Object.keys(payload.peeks).length,
      skippedPeeks: payload.meta.skippedPeeks.length,
      bytes,
    });

    return new NextResponse(html, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": buildContentDisposition(filename, filename),
        "Content-Length": String(bytes),
      },
    });
  } catch (error) {
    logger.error("Cascade export failed", LOG_SERVICE, { error: String(error) });
    // A document without its bundle is a blank page — refuse to serve one.
    if (error instanceof CascadeBundleMissingError) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json(
      { error: "Failed to build trace export" },
      { status: 502, headers: NO_STORE },
    );
  }
}
