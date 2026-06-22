import { NextRequest, NextResponse } from "next/server";

type RouteParams = { params: Promise<{ logId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { logId } = await params;
  const body = await request.json().catch(() => ({}));

  return NextResponse.json({
    success: true,
    data: {
      evalSetRef: body?.evalSetId ?? "mock-evalset-ref",
      requirementRef: `mock-req-ref-${logId}`,
      triggerRef: "mock-trigger-ref",
    },
  });
}
