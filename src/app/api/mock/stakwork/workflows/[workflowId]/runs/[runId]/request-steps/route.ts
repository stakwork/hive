import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ workflowId: string; runId: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { workflowId, runId } = await params;
  void workflowId;
  void runId;

  return NextResponse.json({
    success: true,
    data: {
      steps: [
        {
          stepId: "llm_generate_title",
          name: "Generate Title",
          model: "gpt-4o-mini",
          provider: "openai",
          endpoint_url: "https://api.openai.com/v1/chat/completions",
          preview: "SKIP",
        },
        {
          stepId: "llm_evaluate_quality",
          name: "Evaluate Quality",
          model: "claude-3-5-sonnet-20241022",
          provider: "anthropic",
          endpoint_url: "https://api.anthropic.com/v1/messages",
          preview: "The output looks correct.",
        },
      ],
    },
  });
}
