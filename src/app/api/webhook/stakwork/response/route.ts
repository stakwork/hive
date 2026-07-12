import { NextRequest, NextResponse } from "next/server";
import { StakworkRunWebhookSchema } from "@/types/stakwork";
import { processStakworkRunWebhook } from "@/services/stakwork-run";
import { StakworkRunType } from "@prisma/client";

export const fetchCache = "force-no-store";

/** Legal Benchmark run types that use a flat Harvey payload shape */
const LEGAL_BENCHMARK_TYPES = new Set<string>([
  StakworkRunType.LEGAL_BENCHMARK_RUNNER,
  StakworkRunType.LEGAL_BENCHMARK_SCORER,
  StakworkRunType.LEGAL_BENCHMARK_EVAL,
]);

/**
 * Normalize the flat Harvey LAB webhook payload into the standard
 * `{ result: {...} }` shape that `StakworkRunWebhookSchema` expects.
 *
 * Harvey workflows POST either:
 *   runner:  { final_output, output_s3_url, project_status?, project_id? }
 *   scorer:  { scores, project_status?, project_id? }
 *
 * Since `StakworkRunWebhookSchema` uses `result: z.unknown()` with no
 * unknown-key stripping at the top level, we can safely nest Harvey's
 * fields under `result` while preserving `project_status` / `project_id`.
 */
function normalizeLegalBenchmarkPayload(body: Record<string, unknown>): Record<string, unknown> {
  const { project_status, project_id, recap_unchanged, ...harveyFields } = body;
  return {
    result: harveyFields,
    ...(project_status !== undefined ? { project_status } : {}),
    ...(project_id !== undefined ? { project_id } : {}),
    ...(recap_unchanged !== undefined ? { recap_unchanged } : {}),
  };
}

/**
 * POST /api/webhook/stakwork/response
 * Generic webhook receiver for Stakwork AI generation results.
 *
 * Query params:
 *   type          — StakworkRunType value
 *   workspace_id  — workspace that owns the run
 *   run_id        — (preferred) exact StakworkRun id
 *   feature_id    — (optional) feature FK
 *   whiteboard_id — (optional) whiteboard FK for DIAGRAM_GENERATION
 *   layout        — (optional) ELK layout algorithm for DIAGRAM_GENERATION
 *   run_token     — (required for LEGAL_BENCHMARK_*) HMAC-SHA256 token
 *                   embedded in the webhook_url at run-creation time
 */
export async function POST(request: NextRequest) {
  try {
    // Parse query parameters
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const workspace_id = url.searchParams.get("workspace_id");
    const feature_id = url.searchParams.get("feature_id");
    const whiteboard_id = url.searchParams.get("whiteboard_id");
    const layout = url.searchParams.get("layout");
    const run_id = url.searchParams.get("run_id");
    const run_token = url.searchParams.get("run_token");

    // Validate required query params
    if (!type || !workspace_id) {
      return NextResponse.json(
        { error: "Missing required query parameters: type, workspace_id" },
        { status: 400 }
      );
    }

    // Validate type enum
    if (!Object.values(StakworkRunType).includes(type as StakworkRunType)) {
      return NextResponse.json(
        { error: `Invalid type: ${type}` },
        { status: 400 }
      );
    }

    // Parse the raw request body
    let rawBody: Record<string, unknown>;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // For Legal Benchmark types: normalize the flat Harvey payload into the
    // standard { result: {...} } shape before schema validation.
    const bodyToValidate = LEGAL_BENCHMARK_TYPES.has(type)
      ? normalizeLegalBenchmarkPayload(rawBody)
      : rawBody;

    // Parse and validate webhook body
    const validationResult = StakworkRunWebhookSchema.safeParse(bodyToValidate);

    if (!validationResult.success) {
      console.error("Invalid webhook payload:", validationResult.error);
      return NextResponse.json(
        {
          error: "Invalid webhook payload",
          details: validationResult.error.format(),
        },
        { status: 400 }
      );
    }

    const webhookData = validationResult.data;

    // Process the webhook
    const result = await processStakworkRunWebhook(webhookData, {
      type,
      workspace_id,
      feature_id: feature_id || undefined,
      whiteboard_id: whiteboard_id || undefined,
      layout: layout || undefined,
      run_id: run_id || undefined,
      run_token: run_token || undefined,
    });

    return NextResponse.json(
      {
        success: true,
        runId: result.runId,
        status: result.status,
        dataType: result.dataType,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error processing Stakwork webhook:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Failed to process webhook";

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
