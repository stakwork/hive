import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { db } from "@/lib/db";
import type { ContextTag, Artifact } from "@/lib/chat";
import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";
import {
  resolveWorkspaceAccess,
  requireReadAccess,
  requireMemberAccess,
  isPublicViewer,
} from "@/lib/auth/workspace-access";
import { toPublicUser, redactArtifactContentForPublic } from "@/lib/auth/public-redact";
import { appendAnswerRow } from "@/services/canvas-planner-forms";
import { logger } from "@/lib/logger";
import { resolveRetryMessage } from "./helpers";

/** Minimum seconds between retries on the same feature to prevent abuse. */
const RETRY_THROTTLE_SECONDS = 10;

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

interface AttachmentRequest {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * GET /api/features/[featureId]/chat
 * Load existing chat messages for a feature
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  try {
    const { featureId } = await params;

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    // Auth: x-api-token callers are trusted service-to-service clients that
    // bypass membership. Everyone else is resolved through
    // `resolveWorkspaceAccess`, which enforces workspace membership (or
    // public-viewer on `isPublicViewable` workspaces). `requireAuthOrApiToken`
    // alone would accept any authenticated user regardless of membership
    // and leak the feature's chat history across tenants.
    const apiTokenAuth =
      request.headers.get("x-api-token") === process.env.API_TOKEN;
    let redactForPublic = false;

    if (apiTokenAuth) {
      const apiResult = await requireAuthOrApiToken(request, feature.workspaceId);
      if (apiResult instanceof NextResponse) return apiResult;
    } else {
      const access = await resolveWorkspaceAccess(request, {
        workspaceId: feature.workspaceId,
      });
      const ok = requireReadAccess(access);
      if (ok instanceof NextResponse) return ok;
      redactForPublic = isPublicViewer(ok);
    }

    const messages = await db.chatMessage.findMany({
      where: { featureId },
      include: {
        artifacts: true,
        attachments: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const clientMessages = messages.map((msg) => ({
      ...msg,
      createdBy: redactForPublic
        ? (toPublicUser(msg.createdBy) || undefined)
        : (msg.createdBy || undefined),
      contextTags: JSON.parse(msg.contextTags as string) as ContextTag[],
      // For public viewers, scrub credential-bearing artifact content
      // (pod URL + agentPassword on IDE/BROWSER, stream tokens, etc).
      artifacts: msg.artifacts.map((artifact) => ({
        ...artifact,
        content: redactForPublic
          ? redactArtifactContentForPublic(artifact.type, artifact.content)
          : (artifact.content as unknown),
      })) as Artifact[],
    }));

    return NextResponse.json({ success: true, data: clientMessages }, { status: 200 });
  } catch (error) {
    console.error("Error fetching feature chat messages:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

/**
 * POST /api/features/[featureId]/chat
 * Send a message in a feature-level conversation, triggers Stakwork workflow
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  try {
    const { featureId } = await params;
    // Unconditional entry breadcrumb so the request is visible in
    // logs even when something fails before any other log fires.
    console.log(
      `[features/chat] POST /api/features/${featureId}/chat received`,
    );

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true, parentCanvasConversationId: true },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    // POST is a write: x-api-token is still accepted for service callers,
    // but session-authenticated requests must belong to the workspace.
    // Without the membership check any signed-in user could inject chat
    // messages into any workspace's feature conversations and trigger
    // downstream Stakwork workflows on the victim's account.
    const apiTokenAuth =
      request.headers.get("x-api-token") === process.env.API_TOKEN;
    let userOrResponse: Awaited<ReturnType<typeof requireAuthOrApiToken>>;

    if (apiTokenAuth) {
      userOrResponse = await requireAuthOrApiToken(request, feature.workspaceId);
      if (userOrResponse instanceof NextResponse) return userOrResponse;
    } else {
      const access = await resolveWorkspaceAccess(request, {
        workspaceId: feature.workspaceId,
      });
      const member = requireMemberAccess(access);
      if (member instanceof NextResponse) return member;
      userOrResponse = {
        id: member.userId,
        email: "",
        name: "",
      };
    }

    const body = await request.json();
    const {
      retry,
      message,
      contextTags = [],
      sourceWebsocketID,
      webhook,
      replyId,
      history: bodyHistory,
      isPrototype,
      attachments = [] as AttachmentRequest[],
      model,
      selectedRepositoryIds,
    } = body;

    // ── Retry branch ────────────────────────────────────────────────────────
    // Checked BEFORE the message/attachments guard so a bare { retry: true }
    // body isn't rejected by that guard.
    if (retry === true) {
      // Reject conflated requests: retry + message in same body is ambiguous.
      if (message && message.length > 0) {
        return NextResponse.json(
          { error: "Cannot combine retry with a message" },
          { status: 400 },
        );
      }

      // Abuse guard: reject rapid retries using the feature's updatedAt as a
      // proxy for the last status transition (no new column needed). Each
      // retry re-runs the full planning pipeline, so we throttle independently
      // of the existing IN_PROGRESS check (which doesn't fire once HALTED).
      const featureForRetry = await db.feature.findUnique({
        where: { id: featureId },
        select: { updatedAt: true },
      });
      if (featureForRetry) {
        const secondsSinceUpdate =
          (Date.now() - featureForRetry.updatedAt.getTime()) / 1000;
        if (secondsSinceUpdate < RETRY_THROTTLE_SECONDS) {
          logger.warn(
            `[features/chat] retry rate-limited: featureId=${featureId} secondsSinceUpdate=${secondsSinceUpdate.toFixed(1)}`,
          );
          return NextResponse.json(
            { error: "Retry too soon — please wait a moment before retrying" },
            { status: 429 },
          );
        }
      }

      // Resolve message from chat history scoped strictly to this feature.
      const history = await db.chatMessage.findMany({
        where: { featureId },
        orderBy: { createdAt: "asc" },
        select: { role: true, message: true },
      });

      const retryMessage = resolveRetryMessage(history);
      if (!retryMessage) {
        logger.warn(
          `[features/chat] retry found nothing resendable: featureId=${featureId}`,
        );
        return NextResponse.json(
          { error: "Nothing to retry" },
          { status: 400 },
        );
      }

      const { chatMessage, stakworkData } = await sendFeatureChatMessage({
        featureId,
        userId: userOrResponse.id,
        message: retryMessage,
      });

      const clientMessage = {
        ...chatMessage,
        createdBy: chatMessage.createdBy || undefined,
        contextTags: JSON.parse(chatMessage.contextTags as string) as ContextTag[],
        artifacts: chatMessage.artifacts.map((artifact) => ({
          ...artifact,
          content: artifact.content as unknown,
        })) as Artifact[],
      };

      return NextResponse.json(
        { success: true, message: clientMessage, workflow: stakworkData?.data },
        { status: 201 },
      );
    }

    // ── Normal send branch ──────────────────────────────────────────────────
    if (!message && attachments.length === 0) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const { chatMessage, stakworkData } = await sendFeatureChatMessage({
      featureId,
      userId: userOrResponse.id,
      message,
      contextTags,
      sourceWebsocketID,
      webhook,
      replyId,
      history: bodyHistory,
      isPrototype,
      attachments,
      model,
      selectedRepositoryIds,
    });

    // When the user answers a clarifying-question FORM on the Feature page,
    // mirror the answer into the owning canvas conversation so the sidebar
    // PlannerFormSlot dismisses via the existing canvas-conversation-updated
    // Pusher mechanism. Best-effort: a failure must not fail the request.
    if (replyId && feature.parentCanvasConversationId) {
      try {
        await appendAnswerRow(
          feature.parentCanvasConversationId,
          featureId,
          replyId,
          message,
        );
      } catch (e) {
        console.error("[features/chat] canvas append failed (non-fatal):", e);
      }
    }

    const clientMessage = {
      ...chatMessage,
      createdBy: chatMessage.createdBy || undefined,
      contextTags: JSON.parse(chatMessage.contextTags as string) as ContextTag[],
      artifacts: chatMessage.artifacts.map((artifact) => ({
        ...artifact,
        content: artifact.content as unknown,
      })) as Artifact[],
    };

    return NextResponse.json(
      {
        success: true,
        message: clientMessage,
        workflow: stakworkData?.data,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating feature chat message:", error);
    const msg = error instanceof Error ? error.message : "Failed to create message";
    const status = msg.includes("already running") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
