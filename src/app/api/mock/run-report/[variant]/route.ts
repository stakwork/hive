/**
 * Mock Run Report Bundle Endpoint
 *
 * Stands in for the S3 object GET that the ingest pipeline performs, so the
 * whole fetch → sanitize → project → persist path can be exercised locally
 * without a real bundle (real bundles carry legal transcripts).
 *
 * Gating is 404-when-disabled, matching the mock S3 download endpoint
 * (`/api/mock/s3/download/[...key]`). That is the correct analogue: this stands
 * in for an object-store GET, not a third-party API — the 403 convention used
 * by `/api/mock/gemini/*` governs API mocks.
 *
 * Fixtures are served VERBATIM AND UNSANITIZED. That is the entire point: the
 * adversarial fixture has to reach the real sanitizer for the pipeline test to
 * mean anything.
 *
 * Only active when USE_MOCKS=true
 */

import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { getRunReportFixture, RUN_REPORT_FIXTURE_NAMES } from "../fixtures";

const USE_MOCKS = config.USE_MOCKS;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ variant: string }> },
) {
  // Mock gating — return 404 if mocks are disabled
  if (!USE_MOCKS) {
    return NextResponse.json({ error: "Mock endpoints are disabled" }, { status: 404 });
  }

  const { variant } = await params;

  // Resolved through a hardcoded literal record of statically-imported
  // fixtures. Never concatenate the variant into a filesystem path — that is a
  // traversal primitive, and this route is reachable with an arbitrary segment.
  const fixture = getRunReportFixture(variant);

  if (!fixture) {
    return NextResponse.json(
      { error: `Unknown fixture: ${variant}`, available: RUN_REPORT_FIXTURE_NAMES },
      { status: 404 },
    );
  }

  return NextResponse.json(fixture, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
