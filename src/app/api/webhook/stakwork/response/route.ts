import { NextRequest, NextResponse } from "next/server";
import { StakworkRunWebhookSchema } from "@/types/stakwork";
import { processStakworkRunWebhook } from "@/services/stakwork-run";
import { StakworkRunType } from "@prisma/client";

export const fetchCache = "force-no-store";

/**
 * Legal Benchmark run types that use a flat Harvey payload shape.
 *
 * TODO(consolidated): Add `StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED` here
 * ONLY after the Stakwork team confirms that workflow 58345 uses the same
 * flat Harvey payload shape as RUNNER/SCORER/EVAL (not the nested shape used
 * by LEGAL_BENCHMARK_RECURSION). Adding it prematurely when the payload is
 * nested would double-wrap `result` and corrupt `report_url` extraction,
 * potentially persisting the S3 URL inside the result JSON blob.
 */
const LEGAL_BENCHMARK_TYPES = new Set<string>([
  StakworkRunType.LEGAL_BENCHMARK_RUNNER,
  StakworkRunType.LEGAL_BENCHMARK_SCORER,
  StakworkRunType.LEGAL_BENCHMARK_EVAL,
  // TODO(consolidated-wire-format): LEGAL_BENCHMARK_CONSOLIDATED is included here
  // ONLY if workflow 58345 sends a Harvey flat-payload (same shape as RUNNER/SCORER/EVAL).
  // If it follows RECURSION's nested-result path instead, remove this line — adding it
  // incorrectly would double-wrap `result` and corrupt `report_url` extraction.
  // Confirm with the Stakwork team before deploying. Current assumption: flat payload.
  StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED,
]);

/**
 * Normalize a Harvey LAB webhook payload into the standard `{ result: {...} }`
 * shape that `StakworkRunWebhookSchema` expects.
 *
 * Accepts BOTH wire shapes:
 *
 *   flat    { final_output, output_s3_url, n_passed, …, project_status? }
 *           → everything unrecognized is collected into `result`
 *
 *   nested  { result: { final_output, … }, project_status? }
 *           → `result` is passed through as-is
 *
 * The nested form must be unwrapped explicitly. Without this, an explicit
 * `result` key is not one of the destructured names, so it lands in
 * `harveyFields` and gets wrapped a second time — producing `result.result.*`.
 * Every downstream reader (`resultJson.final_output`, `RunnerScoreSchema`)
 * looks one level up from there, so the run would persist with no output and
 * no scores, silently.
 *
 * When both forms appear in one body, the explicit `result` wins per key and
 * stray flat siblings are merged underneath it rather than dropped.
 *
 * Since `StakworkRunWebhookSchema` uses `result: z.unknown()` with no
 * unknown-key stripping at the top level, nesting here is safe.
 */
function normalizeLegalBenchmarkPayload(body: Record<string, unknown>): Record<string, unknown> {
  const { project_status, project_id, recap_unchanged, report_url, result, ...harveyFields } = body;

  // Only a plain object counts as the nested form. A string/array `result` is
  // legacy free-form data and keeps the flat treatment.
  const isNested = typeof result === "object" && result !== null && !Array.isArray(result);

  return {
    result: isNested
      ? { ...harveyFields, ...(result as Record<string, unknown>) }
      : result !== undefined
        ? result
        : harveyFields,
    ...(project_status !== undefined ? { project_status } : {}),
    ...(project_id !== undefined ? { project_id } : {}),
    ...(recap_unchanged !== undefined ? { recap_unchanged } : {}),
    // Preserved at the top level rather than nested under `result`. Everything
    // in `result` is persisted verbatim and served back under
    // includeResult=true, so leaving the bundle URL there would hand it to
    // every workspace member's browser.
    ...(report_url !== undefined ? { report_url } : {}),
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

    // Generic message only. This route is `access: "webhook"` and bypasses auth
    // entirely, so echoing raw `error.message` back would disclose internals —
    // including, on the report path, a URL or host embedded in a thrown error.
    // The detail is in the server log above.
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 }
    );
  }
}
