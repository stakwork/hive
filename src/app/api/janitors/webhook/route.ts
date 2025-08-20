import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";

const stakworkWebhookSchema = z.object({
  projectId: z.number(),
  status: z.string(),
  results: z.object({
    recommendations: z.array(z.object({
      title: z.string(),
      description: z.string(),
      priority: z.string(),
      impact: z.string().optional(),
      metadata: z.record(z.any()).optional(),
    }))
  }).optional(),
  error: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const webhookData = stakworkWebhookSchema.parse(body);

    const { projectId, status, results, error } = webhookData;

    const janitorRun = await db.janitorRun.findFirst({
      where: { 
        stakworkProjectId: projectId,
        status: { in: ["PENDING", "RUNNING"] }
      },
      include: {
        janitorConfig: {
          include: {
            workspace: true
          }
        }
      }
    });

    if (!janitorRun) {
      console.warn(`No active janitor run found for Stakwork project ${projectId}`);
      return NextResponse.json({ 
        error: "No active janitor run found for this project" 
      }, { status: 404 });
    }

    const isCompleted = status.toLowerCase() === "completed" || status.toLowerCase() === "success";
    const isFailed = status.toLowerCase() === "failed" || status.toLowerCase() === "error";

    if (isCompleted) {
      await db.$transaction(async (tx) => {
        await tx.janitorRun.update({
          where: { id: janitorRun.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            metadata: {
              ...janitorRun.metadata as object,
              stakworkStatus: status,
              completedByWebhook: true,
            }
          }
        });

        if (results?.recommendations?.length) {
          const recommendations = results.recommendations.map(rec => {
            let priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "MEDIUM";
            
            if (rec.priority) {
              const priorityUpper = rec.priority.toUpperCase();
              if (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(priorityUpper)) {
                priority = priorityUpper as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
              }
            }

            return {
              janitorRunId: janitorRun.id,
              title: rec.title,
              description: rec.description,
              priority,
              impact: rec.impact,
              status: "PENDING" as const,
              metadata: {
                ...rec.metadata,
                source: "stakwork_webhook",
                janitorType: janitorRun.janitorType,
                workspaceId: janitorRun.janitorConfig.workspace.id,
              }
            };
          });

          await tx.janitorRecommendation.createMany({
            data: recommendations
          });
        }
      });

      console.log(`Janitor run ${janitorRun.id} completed with ${results?.recommendations?.length || 0} recommendations`);
    } else if (isFailed) {
      await db.janitorRun.update({
        where: { id: janitorRun.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          error: error || `Stakwork project failed with status: ${status}`,
          metadata: {
            ...janitorRun.metadata as object,
            stakworkStatus: status,
            failedByWebhook: true,
          }
        }
      });

      console.error(`Janitor run ${janitorRun.id} failed: ${error || status}`);
    } else {
      await db.janitorRun.update({
        where: { id: janitorRun.id },
        data: {
          status: "RUNNING",
          startedAt: janitorRun.startedAt || new Date(),
          metadata: {
            ...janitorRun.metadata as object,
            stakworkStatus: status,
            lastWebhookUpdate: new Date(),
          }
        }
      });

      console.log(`Janitor run ${janitorRun.id} status updated to: ${status}`);
    }

    return NextResponse.json({ 
      success: true,
      message: "Webhook processed successfully",
      runId: janitorRun.id,
      status: isCompleted ? "COMPLETED" : isFailed ? "FAILED" : "RUNNING"
    });

  } catch (error) {
    console.error("Error processing janitor webhook:", error);
    
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json(
        { error: "Invalid webhook payload", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}