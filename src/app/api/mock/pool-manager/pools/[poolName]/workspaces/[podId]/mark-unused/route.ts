import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * DEPRECATED: Mock Pool Manager mark workspace as unused endpoint
 * 
 * This endpoint is no longer used as pod releasing now uses direct database operations
 * via releasePodById() in src/lib/pods/queries.ts.
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
      error: "This endpoint is deprecated. Pod releasing now uses direct database operations." 
    },
    { status: 410 } // 410 Gone
  );
}
