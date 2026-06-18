import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pusherServer, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";

export const fetchCache = "force-no-store";

/**
 * POST /api/webhook/prompt-eval/result?run_id=<id>
 *
 * Receives aggregated pass/fail results from the Stakwork Eval Set Runner
 * workflow. No session auth required — matches the unauthenticated webhook
 * pattern used by other Stakwork result callbacks.
 *
 * Body: { pass: number, fail: number, total: number }
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const runId = searchParams.get("run_id");

    if (!runId) {
      return NextResponse.json({ error: "run_id query parameter is required" }, { status: 400 });
    }

    // Parse and validate body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { pass, fail, total } = body as Record<string, unknown>;

    if (typeof pass !== "number" || typeof fail !== "number" || typeof total !== "number") {
      return NextResponse.json(
        { error: "pass, fail, and total must be present numbers" },
        { status: 400 },
      );
    }

    // Look up the run, include workspace slug for Pusher channel
    const run = await db.stakworkRun.findUnique({
      where: { id: runId },
      include: { workspace: { select: { slug: true } } },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (run.type !== "PROMPT_EVAL") {
      return NextResponse.json(
        { error: "Run is not a PROMPT_EVAL run" },
        { status: 400 },
      );
    }

    // Persist result
    await db.stakworkRun.update({
      where: { id: runId },
      data: {
        result: JSON.stringify({ pass, fail, total }),
        status: "COMPLETED",
        updatedAt: new Date(),
      },
    });

    // Broadcast result via Pusher
    const channel = getWorkspaceChannelName(run.workspace.slug);
    try {
      await pusherServer.trigger(channel, PUSHER_EVENTS.PROMPT_EVAL_RESULT, {
        runId: run.id,
        promptVersionId: run.promptVersionId,
        result: { pass, fail, total },
      });
    } catch (pusherError) {
      // Non-fatal — log and continue
      console.error("[prompt-eval/result] Pusher trigger failed (non-fatal):", pusherError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[prompt-eval/result] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
