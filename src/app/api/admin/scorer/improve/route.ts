import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { runImprovement } from "@/lib/scorer/improve";

/**
 * POST — run the self-improvement agent for one insight. The agent edits the
 * workspace description (the doc injected into coding-agent system prompts)
 * and records a proposal for human approval.
 *
 * Body: { insightId: string, prompt?: string }
 */
export async function POST(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const insightId = body?.insightId as string | undefined;
    const prompt = body?.prompt as string | undefined;

    if (!insightId) {
      return NextResponse.json(
        { error: "insightId is required" },
        { status: 400 }
      );
    }

    const result = await runImprovement({
      insightId,
      userPrompt: prompt?.trim() || undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error running improvement agent:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
