import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService, timingSafeEqual } from "@/lib/encryption";
import { ChatRole, ChatStatus, ArtifactType, WorkflowStatus, NotificationTriggerType } from "@prisma/client";
import { createAndSendNotification } from "@/services/notifications";
import { pusherServer, getFeatureChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { VerifyCallbackPayload } from "@/services/attestor/types";

export const fetchCache = "force-no-store";

const encryptionService = EncryptionService.getInstance();

export async function POST(request: NextRequest, { params }: { params: Promise<{ featureId: string }> }) {
  try {
    const { featureId } = await params;

    if (!featureId) {
      return NextResponse.json({ error: "Feature ID required" }, { status: 400 });
    }

    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const feature = await db.feature.findUnique({
      where: { id: featureId, deleted: false },
      select: {
        id: true,
        title: true,
        verifyCallbackKey: true,
        assigneeId: true,
        createdById: true,
        workspaceId: true,
        workspace: { select: { slug: true } },
      },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    if (!feature.verifyCallbackKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let decryptedKey: string;
    try {
      const encryptedData = JSON.parse(feature.verifyCallbackKey);
      decryptedKey = encryptionService.decryptField("agentPassword", encryptedData);
    } catch (error) {
      console.error("[attestor] Failed to decrypt verifyCallbackKey:", error);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!timingSafeEqual(apiKey, decryptedKey)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let payload: VerifyCallbackPayload;
    try {
      payload = (await request.json()) as VerifyCallbackPayload;
    } catch (error) {
      console.error("[attestor] Failed to parse callback payload:", error);
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const passed = payload.overall === "passed";
    const workflowStatus = passed ? WorkflowStatus.COMPLETED : WorkflowStatus.FAILED;

    const chatMessage = await db.chatMessage.create({
      data: {
        featureId,
        message: passed ? "Verification passed" : "Verification needs review",
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        artifacts: {
          create: [
            {
              type: ArtifactType.VERIFY,
              content: payload as unknown as object,
              icon: "verify",
            },
          ],
        },
      },
      include: { artifacts: true },
    });

    await db.feature.update({
      where: { id: featureId },
      data: {
        workflowStatus,
        workflowCompletedAt: new Date(),
        verifyCallbackKey: null,
      },
    });

    if (!passed) {
      const targetUserId = feature.assigneeId ?? feature.createdById;
      const featureUrl = `${process.env.NEXTAUTH_URL}/w/${feature.workspace.slug}/plan/${featureId}`;
      void (async () => {
        try {
          const targetUser = await db.user.findUnique({
            where: { id: targetUserId },
            select: { sphinxAlias: true, name: true },
          });
          const alias = targetUser?.sphinxAlias ?? targetUser?.name ?? "User";
          await createAndSendNotification({
            targetUserId,
            featureId,
            workspaceId: feature.workspaceId,
            notificationType: NotificationTriggerType.WORKFLOW_HALTED,
            message: `@${alias} — Verification of '${feature.title}' needs review: ${featureUrl}`,
          });
        } catch (notifError) {
          console.error("[attestor] Error firing WORKFLOW_HALTED notification:", notifError);
        }
      })();
    }

    try {
      void pusherServer
        .trigger(getFeatureChannelName(featureId), PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE, {
          featureId,
          workflowStatus,
          overall: payload.overall,
          at: Date.now(),
        })
        .catch((err) => {
          console.error("[attestor] Pusher broadcast failed (non-fatal):", err);
        });
    } catch (err) {
      console.error("[attestor] Pusher broadcast threw (non-fatal):", err);
    }

    return NextResponse.json({
      success: true,
      data: {
        messageId: chatMessage.id,
        artifactIds: chatMessage.artifacts.map((a) => a.id),
        workflowStatus,
      },
    });
  } catch (error) {
    console.error("[attestor] Unexpected error in verify callback:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
