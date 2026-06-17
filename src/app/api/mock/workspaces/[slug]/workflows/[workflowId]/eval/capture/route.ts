import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ slug: string; workflowId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { slug, workflowId } = await params;
  void slug;
  void workflowId;

  const body = await request.json().catch(() => ({}));
  const { inputs, outputs } = body as { inputs?: unknown; outputs?: unknown };

  return NextResponse.json({
    success: true,
    data: {
      evalSetRef: "mock-evalset-ref",
      requirementRef: "mock-req-ref",
      triggerRef: "mock-trigger-ref",
      prompt_snapshot: JSON.stringify(inputs ?? null),
      output_snapshot: JSON.stringify(outputs ?? null),
    },
  });
}
