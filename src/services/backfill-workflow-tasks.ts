/**
 * Backfill service: Create WorkflowTask rows for existing workflow_editor tasks
 * that have a WORKFLOW-type chat artifact but no WorkflowTask record yet.
 *
 * Idempotent — safe to run multiple times.
 */

import { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/lib/db";

interface WorkflowArtifactContent {
  workflowId?: number;
  workflowName?: string;
  workflowRefId?: string;
  workflowVersionId?: string;
  [key: string]: unknown;
}

export async function backfillWorkflowTasks(
  client: PrismaClient = defaultDb as unknown as PrismaClient,
): Promise<{ created: number; skipped: number }> {
  // Only process tasks that don't yet have a WorkflowTask row
  const tasks = await client.task.findMany({
    where: {
      mode: "workflow_editor",
      workflowTask: null,
    },
    include: {
      chatMessages: {
        include: {
          artifacts: {
            where: { type: "WORKFLOW" },
            take: 1,
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  let created = 0;
  let skipped = 0;

  for (const task of tasks) {
    // Find the first message that carries a WORKFLOW artifact
    const messageWithArtifact = task.chatMessages.find(
      (msg) => msg.artifacts.length > 0,
    );

    if (!messageWithArtifact) {
      console.warn(
        `[WorkflowTask Backfill] Skipping task ${task.id} — no WORKFLOW artifact found`,
      );
      skipped++;
      continue;
    }

    const artifact = messageWithArtifact.artifacts[0];
    const content = artifact.content as WorkflowArtifactContent | null;

    if (!content || typeof content.workflowId !== "number") {
      console.warn(
        `[WorkflowTask Backfill] Skipping task ${task.id} — WORKFLOW artifact missing workflowId`,
      );
      skipped++;
      continue;
    }

    await client.workflowTask.upsert({
      where: { taskId: task.id },
      update: {},
      create: {
        taskId: task.id,
        workflowId: content.workflowId,
        workflowName: content.workflowName ?? null,
        workflowRefId: content.workflowRefId ?? null,
        workflowVersionId: content.workflowVersionId ?? null,
      },
    });

    created++;
  }

  console.log(
    `[WorkflowTask Backfill] Created ${created} rows from existing WFE artifacts (skipped ${skipped})`,
  );

  return { created, skipped };
}
