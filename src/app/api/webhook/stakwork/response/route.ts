import { NextRequest, NextResponse } from "next/server";
import { StakworkRunWebhookSchema } from "@/types/stakwork";
import { processStakworkRunWebhook } from "@/services/stakwork-run";
import { StakworkRunType } from "@prisma/client";

export const fetchCache = "force-no-store";

/**
 * POST /api/webhook/stakwork/response
 * Generic webhook receiver for Stakwork AI generation results
 * Query params: type, workspace_id, feature_id (optional)
 */
export async function POST(request: NextRequest) {
  try {
    // Parse query parameters
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const workspace_id = url.searchParams.get("workspace_id");
    const feature_id = url.searchParams.get("feature_id");
    const layout = url.searchParams.get("layout");

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

    // Parse and validate webhook body
    const body = await request.json();
    const validationResult = StakworkRunWebhookSchema.safeParse(body);

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
      layout: layout || undefined,
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
