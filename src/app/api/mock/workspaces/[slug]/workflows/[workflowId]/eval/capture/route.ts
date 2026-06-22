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
  const { inputs, outputs, evalSetId, prompts, requirementId } = body as {
    inputs?: unknown;
    outputs?: unknown;
    evalSetId?: string;
    prompts?: unknown;
    requirementId?: string;
  };

  if (requirementId) {
    // Attach to existing requirement — skip requirement creation
    return NextResponse.json({
      success: true,
      data: {
        evalSetRef: evalSetId ?? "mock-evalset-ref",
        requirementRef: requirementId,
        triggerRef: "mock-trigger-ref",
        prompt_snapshot: JSON.stringify(inputs ?? null),
        output_snapshot: JSON.stringify(outputs ?? null),
        prompts: prompts ?? [],
        attachedToExisting: true,
      },
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      evalSetRef: evalSetId ?? "mock-evalset-ref",
      requirementRef: "mock-req-ref",
      triggerRef: "mock-trigger-ref",
      prompt_snapshot: JSON.stringify(inputs ?? null),
      output_snapshot: JSON.stringify(outputs ?? null),
      prompts: prompts ?? [],
    },
  });
}
