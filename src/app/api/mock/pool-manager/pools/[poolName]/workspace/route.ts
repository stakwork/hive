import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * DEPRECATED: Mock Pool Manager get workspace endpoint
 * 
 * This endpoint is no longer used as pod claiming now uses direct database operations
 * via claimAvailablePod() in src/lib/pods/queries.ts instead of Pool Manager API calls.
 * 
 * Keeping this file to prevent 404 errors if any legacy code still references it.
 */

interface RouteContext {
  params: Promise<{
    poolName: string;
  }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  return NextResponse.json(
    { 
      error: "This endpoint is deprecated. Pod claiming now uses direct database operations via claimAvailablePod()." 
    },
    { status: 410 } // 410 Gone
  );
}
