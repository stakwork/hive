import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { ensureUniqueBountyCode } from "@/lib/bounty-code";
import { generateSphinxBountyUrl } from "@/lib/sphinx-tribes";
import { TaskStatus } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

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
    const { title, description, sourceTaskId, sourceWorkspaceSlug } = body;

    // Validate required fields
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!sourceTaskId || !sourceWorkspaceSlug) {
      return NextResponse.json({ error: "Source task information is required" }, { status: 400 });
    }

    // Look up the leetbox workspace
    const leetboxWorkspace = await db.workspace.findFirst({
      where: {
        slug: "leetbox",
        deleted: false,
      },
      select: {
        id: true,
      },
    });

    if (!leetboxWorkspace) {
      return NextResponse.json({ error: "Leetbox workspace not found" }, { status: 404 });
    }

    // Generate a unique bounty code
    const bountyCode = await ensureUniqueBountyCode();

    // Create the bounty task in leetbox workspace
    const task = await db.task.create({
      data: {
        title: title.trim(),
        description: description?.trim() || "",
        workspaceId: leetboxWorkspace.id,
        status: TaskStatus.TODO,
        bountyCode,
        createdById: userId,
        updatedById: userId,
      },
      select: {
        id: true,
        title: true,
        bountyCode: true,
      },
    });

    // Build description with task link and account info (now that we have the task ID)
    const taskUrl = `https://hive.sphinx.chat/w/leetbox/task/${task.id}`;
    const descriptionParts = [
      description?.trim() || "",
      "",
      `---`,
      `Task: ${taskUrl}`,
      "",
      `If you don't have an account, [click here](https://hive.sphinx.chat) to sign up.`,
    ].filter(Boolean);
    const fullDescription = descriptionParts.join("\n");

    // Update task with full description
    const updatedTask = await db.task.update({
      where: { id: task.id },
      data: { description: fullDescription },
      select: {
        id: true,
        title: true,
        description: true,
        bountyCode: true,
      },
    });

    // Generate the Sphinx Tribes URL
    const bountyUrl = generateSphinxBountyUrl({
      id: updatedTask.id,
      title: updatedTask.title,
      description: updatedTask.description || undefined,
      bountyCode: updatedTask.bountyCode || undefined,
    });

    return NextResponse.json(
      {
        success: true,
        taskId: updatedTask.id,
        bountyUrl,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating bounty request:", error);
    return NextResponse.json({ error: "Failed to create bounty request" }, { status: 500 });
  }
}
