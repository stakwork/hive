import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { ensureUniqueBountyCode } from "@/lib/bounty-code";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { EncryptionService } from "@/lib/encryption";
import { callStakworkBountyAPI } from "@/services/task-workflow";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { ChatRole, ChatStatus, ArtifactType, Prisma } from "@prisma/client";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { BountyContent } from "@/lib/chat";

const encryptionService = EncryptionService.getInstance();

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const body = await request.json();
    const {
      title,
      description,
      sourceTaskId,
      sourceWorkspaceSlug,
      sourceWorkspaceId,
      estimatedHours,
      dueDate,
      priceUsd,
      priceSats,
      staking,
    } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!sourceTaskId || !sourceWorkspaceSlug) {
      return NextResponse.json({ error: "Source task information is required" }, { status: 400 });
    }

    // Generate a unique bounty code
    const bountyCode = await ensureUniqueBountyCode();

    // Look up source task to get podId and agentPassword
    const sourceTask = await db.task.findUnique({
      where: { id: sourceTaskId },
      select: {
        podId: true,
        agentPassword: true,
      },
    });

    if (!sourceTask) {
      return NextResponse.json({ error: "Source task not found" }, { status: 404 });
    }

    // Create PENDING bounty artifact
    const bountyContent: BountyContent = {
      status: "PENDING",
      bountyTitle: title.trim(),
      bountyDescription: description?.trim() || "",
      estimatedHours,
      dueDate,
      priceUsd,
      priceSats,
      staking,
      bountyCode,
      sourceTaskId,
      sourceWorkspaceId: sourceWorkspaceId || "",
      sourceWorkspaceSlug,
      sourceUserId: userId,
    };

    const chatMessage = await db.chatMessage.create({
      data: {
        taskId: sourceTaskId,
        message: "Generating bounty workspace...",
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        contextTags: JSON.stringify([]),
        artifacts: {
          create: {
            type: ArtifactType.BOUNTY,
            content: bountyContent as unknown as Prisma.InputJsonValue,
          },
        },
      },
      include: {
        artifacts: true,
      },
    });

    const artifactId = chatMessage.artifacts[0].id;

    // Broadcast to Pusher so the card appears in chat
    try {
      const channelName = getTaskChannelName(sourceTaskId);
      await pusherServer.trigger(channelName, PUSHER_EVENTS.NEW_MESSAGE, chatMessage.id);
    } catch (pusherError) {
      console.error("Failed to broadcast bounty artifact:", pusherError);
    }

    // Get GitHub credentials
    const githubProfile = await getGithubUsernameAndPAT(userId, sourceWorkspaceSlug);
    const username = githubProfile?.username || "";
    const accessToken = githubProfile?.token || "";

    // Decrypt agent password if available
    const agentPassword = sourceTask.agentPassword
      ? encryptionService.decryptField("agentPassword", sourceTask.agentPassword)
      : "";

    // Fire and forget — Stackwork will call back when done
    callStakworkBountyAPI({
      taskId: sourceTaskId,
      podId: sourceTask.podId || "",
      agentPassword: agentPassword || "",
      username,
      accessToken,
      bountyTitle: title.trim(),
      bountyDescription: description?.trim() || "",
      artifactId,
    }).then((result) => {
      console.log("[bounty-request] Stakwork bounty API result:", result);
    }).catch((err) => {
      console.error("[bounty-request] Stakwork bounty API error:", err);
    });

    return NextResponse.json(
      {
        success: true,
        bountyCode,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating bounty request:", error);
    return NextResponse.json({ error: "Failed to create bounty request" }, { status: 500 });
  }
}
