import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService, timingSafeEqual } from "@/lib/encryption";
import { ChatRole, ChatStatus, ArtifactType, WorkflowStatus, NotificationTriggerType, Prisma } from "@prisma/client";
import { createAndSendNotification } from "@/services/notifications";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { AuditVerdict } from "@/services/auditor/types";

export const fetchCache = "force-no-store";

const encryptionService = EncryptionService.getInstance();

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    if (!taskId) {
      return NextResponse.json({ error: "Task ID required" }, { status: 400 });
    }

    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const task = await db.task.findUnique({
      where: { id: taskId, deleted: false },
      select: {
        id: true,
        auditCallbackKey: true,
        workspaceId: true,
        assigneeId: true,
        createdById: true,
        title: true,
        workspace: { select: { slug: true } },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (!task.auditCallbackKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let decryptedKey: string;
    try {
      const encryptedData = JSON.parse(task.auditCallbackKey);
      decryptedKey = encryptionService.decryptField("auditCallbackKey", encryptedData);
    } catch (error) {
      console.error("Failed to decrypt auditCallbackKey:", error);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!timingSafeEqual(apiKey, decryptedKey)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let verdict: AuditVerdict;
    try {
      verdict = (await request.json()) as AuditVerdict;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const overall = verdict.overall;
    const works = overall === "works";
    const workflowStatus = works ? WorkflowStatus.COMPLETED : WorkflowStatus.FAILED;

    const summaryText = verdict.summary || `Audit verdict: ${overall}`;

    const evidence = Array.isArray(verdict.evidence) ? verdict.evidence : [];

    await db.chatMessage.create({
      data: {
        taskId,
        message: summaryText,
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        artifacts: {
          create: [
            {
              type: ArtifactType.VERIFY,
              content: {
                overall,
                claims: verdict.claims ?? [],
                observations: verdict.observations ?? [],
                summary: summaryText,
                evidence,
                startedAt: verdict.startedAt ?? "",
                finishedAt: verdict.finishedAt ?? "",
                error: verdict.error ?? "",
              } as unknown as Prisma.InputJsonValue,
              icon: "verify",
            },
          ],
        },
      },
    });

    await db.task.update({
      where: { id: taskId },
      data: {
        workflowStatus,
        workflowCompletedAt: new Date(),
        auditCallbackKey: null,
      },
    });

    if (!works) {
      const targetUserId = task.assigneeId ?? task.createdById;
      const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      const taskUrl = `${baseUrl}/w/${task.workspace.slug}/task/${taskId}`;
      try {
        await createAndSendNotification({
          targetUserId,
          taskId,
          workspaceId: task.workspaceId,
          notificationType: NotificationTriggerType.WORKFLOW_HALTED,
          message: `Audit flagged task '${task.title}' as ${overall} — needs a human: ${taskUrl}`,
        });
      } catch (notifError) {
        console.error("[auditor:callback] Failed to fire WORKFLOW_HALTED notification:", notifError);
      }
    }

    try {
      await pusherServer.trigger(getTaskChannelName(taskId), PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE, {
        taskId,
        workflowStatus,
        timestamp: new Date(),
      });
    } catch (pusherError) {
      console.error("[auditor:callback] Pusher broadcast failed:", pusherError);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Unexpected error in audit callback:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
