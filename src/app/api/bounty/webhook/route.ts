import { db } from "@/lib/db";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { NextRequest, NextResponse } from "next/server";
import { ArtifactType, Prisma } from "@prisma/client";
import type { BountyContent } from "@/lib/chat";

export async function PUT(request: NextRequest) {
  try {
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken || apiToken !== process.env.API_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { artifactId, taskId, workspaceId, workspaceSlug, repoUrl, targetWorkspaceId } = body;

    if (!artifactId || !taskId) {
      return NextResponse.json({ error: "artifactId and taskId are required" }, { status: 400 });
    }

    const artifact = await db.artifact.findUnique({
      where: { id: artifactId },
    });

    if (!artifact) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    if (artifact.type !== ArtifactType.BOUNTY) {
      return NextResponse.json({ error: "Artifact is not a bounty" }, { status: 400 });
    }

    const existingContent = artifact.content as unknown as BountyContent;
    const updatedContent: BountyContent = {
      ...existingContent,
      status: "READY",
      workspaceId: workspaceId || "",
      workspaceSlug: workspaceSlug || "",
      repoUrl: repoUrl || "",
      targetWorkspaceId: targetWorkspaceId || "",
    };

    await db.artifact.update({
      where: { id: artifactId },
      data: {
        content: updatedContent as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      const channelName = getTaskChannelName(taskId);
      await pusherServer.trigger(channelName, PUSHER_EVENTS.BOUNTY_STATUS_CHANGE, {
        taskId,
        artifactId,
        content: updatedContent,
      });
    } catch (pusherError) {
      console.error("Failed to broadcast bounty status change:", pusherError);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error updating bounty artifact:", error);
    return NextResponse.json({ error: "Failed to update bounty" }, { status: 500 });
  }
}
