import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";
import {
  pusherServer,
  getWorkspaceChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";

export const fetchCache = "force-no-store";

/**
 * POST /api/legal/benchmark/webhook
 *
 * Public endpoint called by Stakwork to advance the Harvey LAB pipeline.
 * No user session — authentication is via run_id existence + workspace ownership.
 *
 * Query params:
 *   run_id  — ID of the LegalBenchmarkRun record
 *   stage   — "runner" | "scorer"
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("run_id");
  const stage = url.searchParams.get("stage");

  if (!runId || !stage) {
    return NextResponse.json(
      { error: "run_id and stage query params are required" },
      { status: 400 },
    );
  }

  const run = await db.legalBenchmarkRun.findUnique({ where: { id: runId } });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Look up workspace slug for Pusher channel
  const workspace = await db.workspace.findUnique({
    where: { id: run.workspaceId },
    select: { slug: true },
  });

  const broadcastStatus = async (status: string) => {
    try {
      await pusherServer.trigger(
        getWorkspaceChannelName(workspace?.slug ?? run.workspaceId),
        PUSHER_EVENTS.LEGAL_BENCHMARK_UPDATE,
        { run_id: runId, status },
      );
    } catch (err) {
      console.error("[legal/benchmark/webhook] Pusher broadcast failed (non-fatal):", err);
    }
  };

  try {
    if (stage === "runner") {
      let body: { final_output?: string; output_s3_url?: string };
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }

      const { final_output, output_s3_url } = body;
      if (!final_output || typeof final_output !== "string") {
        return NextResponse.json(
          { error: "final_output (string) is required" },
          { status: 400 },
        );
      }
      if (!output_s3_url || typeof output_s3_url !== "string") {
        return NextResponse.json(
          { error: "output_s3_url (string) is required" },
          { status: 400 },
        );
      }

      // Validate scorer workflow env var before advancing state
      const scorerWorkflowId = process.env.STAKWORK_HARVEY_SCORER_WORKFLOW_ID;
      if (!scorerWorkflowId) {
        return NextResponse.json(
          { error: "STAKWORK_HARVEY_SCORER_WORKFLOW_ID is not configured" },
          { status: 500 },
        );
      }

      // Advance to SCORING
      await db.legalBenchmarkRun.update({
        where: { id: runId },
        data: {
          runnerOutputText: final_output,
          runnerOutputUrl: output_s3_url,
          status: "SCORING",
        },
      });

      // Fire the Evaluator (fire-and-forget — scorer failures surface via their own webhook)
      const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      const scorerWebhookUrl = `${baseUrl}/api/legal/benchmark/webhook?run_id=${runId}&stage=scorer`;

      const scorerPayload = {
        name: `harvey-scorer-${runId}`,
        workflow_id: parseInt(scorerWorkflowId, 10),
        webhook_url: scorerWebhookUrl,
        workflow_params: {
          set_var: {
            attributes: {
              vars: {
                task_slug: run.taskSlug,
                candidate_s3_url: output_s3_url,
              },
            },
          },
        },
      };

      // Fire scorer and update scorerProjectId non-blocking
      void (async () => {
        try {
          const scorerResponse = await fetch(`${optionalEnvVars.STAKWORK_BASE_URL}/projects`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Token token="${optionalEnvVars.STAKWORK_API_KEY}"`,
            },
            body: JSON.stringify(scorerPayload),
          });

          if (scorerResponse.ok) {
            const scorerData = await scorerResponse.json();
            const scorerProjectId: number | undefined =
              scorerData?.data?.project_id ?? scorerData?.project_id;
            if (scorerProjectId) {
              await db.legalBenchmarkRun.update({
                where: { id: runId },
                data: { scorerProjectId },
              });
            }
          } else {
            console.error(
              `[legal/benchmark/webhook] Scorer Stakwork call failed: ${scorerResponse.status}`,
            );
          }
        } catch (err) {
          console.error("[legal/benchmark/webhook] Scorer fire failed (non-fatal):", err);
        }
      })();

      await broadcastStatus("SCORING");
      return NextResponse.json({ success: true });
    }

    if (stage === "scorer") {
      let body: { scores?: unknown };
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }

      const { scores } = body;
      if (!scores || !Array.isArray(scores)) {
        return NextResponse.json(
          { error: "scores (array) is required" },
          { status: 400 },
        );
      }

      await db.legalBenchmarkRun.update({
        where: { id: runId },
        data: {
          scoreJson: JSON.stringify(scores),
          status: "COMPLETE",
        },
      });

      await broadcastStatus("COMPLETE");
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Unknown stage: ${stage}` }, { status: 400 });
  } catch (error) {
    console.error("[legal/benchmark/webhook] Unhandled error:", error);

    // Mark run as FAILED and broadcast so the UI surfaces the error
    try {
      await db.legalBenchmarkRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      await broadcastStatus("FAILED");
    } catch (persistErr) {
      console.error("[legal/benchmark/webhook] Failed to persist FAILED status:", persistErr);
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
