import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ slug: string; workflowId: string }>;
};

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { slug, workflowId } = await params;
  void slug;
  void workflowId;

  return NextResponse.json({
    success: true,
    data: {
      evalSetRef: "mock-evalset-ref",
      requirementRef: "mock-req-ref",
      triggerRef: "mock-trigger-ref",
    },
  });
}
