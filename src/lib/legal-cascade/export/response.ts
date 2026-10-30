/**
 * The trace export's HTTP response, shared by the Stakwork and strut export
 * routes: the offline document as a private, uncached download.
 */

import { NextResponse } from "next/server";
import { buildContentDisposition } from "@/lib/run-report/export/content-disposition";
import { logger } from "@/lib/logger";
import { assembleCascadeOfflineHtml } from "./offline-html";
import type { CascadeExportPayload } from "./payload";

export const CASCADE_EXPORT_NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function cascadeExportResponse(payload: CascadeExportPayload, logService: string): NextResponse {
  const { runId } = payload.meta;
  const filename = `run-trace-${runId}.html`;
  const html = assembleCascadeOfflineHtml(payload, `Run trace · ${runId}`);
  const bytes = Buffer.byteLength(html, "utf8");

  logger.info("Cascade export built", logService, {
    runId,
    agents: payload.model.summary.agents,
    peeks: Object.keys(payload.peeks).length,
    skippedPeeks: payload.meta.skippedPeeks.length,
    bytes,
  });

  return new NextResponse(html, {
    status: 200,
    headers: {
      ...CASCADE_EXPORT_NO_STORE,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": buildContentDisposition(filename, filename),
      "Content-Length": String(bytes),
    },
  });
}
