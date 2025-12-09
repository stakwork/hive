import { NextRequest, NextResponse } from "next/server";
import { processJanitorWebhook } from "@/services/janitor";
import { JANITOR_ERRORS } from "@/lib/constants/janitor";
import { z } from "zod";

const stakworkWebhookSchema = z.object({
  projectId: z.number(),
  status: z.string(),
  workspaceId: z.string().optional(), // For external workflows without janitor run
  autoCreateTasks: z.boolean().optional(), // Auto-create task from first recommendation
  autoMergePr: z.boolean().optional(), // Auto-merge PR when autoCreateTasks is true
  results: z.object({
    recommendations: z.array(z.object({
      title: z.string(),
      description: z.string(),
      priority: z.string(),
      impact: z.string().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    }))
  }).optional(),
  error: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Check API token authentication
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken || apiToken !== process.env.API_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const webhookData = stakworkWebhookSchema.parse(body);

    const result = await processJanitorWebhook(webhookData);

    const logMessage = result.runId
      ? `Janitor run ${result.runId} processed: ${result.status}`
      : `Standalone recommendations processed: ${result.status}`;

    console.log(`${logMessage}${
      'recommendationCount' in result ? ` with ${result.recommendationCount} recommendations` : ''
    }`);

    return NextResponse.json({
      success: true,
      message: "Webhook processed successfully",
      ...(result.runId && { runId: result.runId }),
      status: result.status,
      ...('recommendationCount' in result ? { recommendationCount: result.recommendationCount } : {}),
      ...('error' in result ? { error: result.error } : {})
    });

  } catch (error) {
    console.error("Error processing janitor webhook:", error);
    
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json(
        { error: "Invalid webhook payload", details: error.issues },
        { status: 400 }
      );
    }

    // Handle service errors
    if (error instanceof Error && error.message.includes(JANITOR_ERRORS.RUN_NOT_FOUND)) {
      return NextResponse.json(
        { error: "No active janitor run found for this project" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}