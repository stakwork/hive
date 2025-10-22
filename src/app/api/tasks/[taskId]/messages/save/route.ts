import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus } from "@prisma/client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const { taskId } = await params;
    const body = await request.json();
    const { message, role } = body;

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    if (!role || (role !== "USER" && role !== "ASSISTANT")) {
      return NextResponse.json({ error: "Valid role is required (USER or ASSISTANT)" }, { status: 400 });
    }

    // Verify task exists and user has access
    const task = await db.task.findFirst({
      where: {
        id: taskId,
        deleted: false,
      },
      select: {
        workspaceId: true,
        workspace: {
          select: {
            ownerId: true,
            members: {
              where: {
                userId: userId,
              },
              select: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Check if user is workspace owner or member
    const isOwner = task.workspace.ownerId === userId;
    const isMember = task.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Create the chat message
    const chatMessage = await db.chatMessage.create({
      data: {
        taskId,
        message,
        role: role as ChatRole,
        contextTags: JSON.stringify([]),
        status: ChatStatus.SENT,
      },
    });

    // Check if message contains [Open PR] to auto-complete task
    if (message.includes("[Open PR]")) {
      await db.task.update({
        where: { id: taskId },
        data: {
          status: "DONE",
        },
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: chatMessage,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error saving chat message:", error);
    return NextResponse.json({ error: "Failed to save chat message" }, { status: 500 });
  }
}
