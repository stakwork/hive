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
          method: "POST",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Generate a title for this content." },
          ],
          body: {
            response_raw: JSON.stringify({
              choices: [{ message: { content: "Sample Title" }, finish_reason: "stop" }],
            }),
            output_text: "Sample Title",
            finish_reason: "stop",
            prompt_change: null,
            model: "gpt-4o-mini",
          },
        },
        {
          stepId: "llm_evaluate_quality",
          name: "Evaluate Quality",
          model: "claude-3-5-sonnet-20241022",
          provider: "anthropic",
          endpoint_url: "https://api.anthropic.com/v1/messages",
          preview: "The output looks correct.",
          method: "POST",
          messages: [
            { role: "system", content: "You are a quality evaluation assistant." },
            { role: "user", content: "Evaluate the quality of the following output." },
          ],
          body: {
            response_raw: JSON.stringify({
              content: [{ text: "The output quality is high.", type: "text" }],
              stop_reason: "end_turn",
            }),
            output_text: "The output quality is high.",
            finish_reason: "end_turn",
            prompt_change: null,
            model: "claude-3-5-sonnet-20241022",
          },
        },
      ],
    },
  });
}
