import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

interface RouteContext {
  params: Promise<{
    poolName: string;
    podId: string;
  }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  return NextResponse.json({ success: true }, { status: 200 });
}
