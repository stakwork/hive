import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * DEPRECATED: Mock Pool Manager mark workspace as used endpoint
 * 
 * This endpoint is no longer used as pod claiming now uses direct database operations
 * with atomic status updates via claimAvailablePod() in src/lib/pods/queries.ts.
 */

interface RouteContext {
  params: Promise<{
    poolName: string;
    podId: string;
  }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  return NextResponse.json(
    { 
      error: "This endpoint is deprecated. Pod claiming now uses direct database operations." 
    },
    { status: 410 } // 410 Gone
  );
}
