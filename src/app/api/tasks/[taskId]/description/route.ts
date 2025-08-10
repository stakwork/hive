import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    // Check API token authentication
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken || apiToken !== process.env.API_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json(
        { error: "Task ID is required" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { description } = body as { description?: unknown };

    if (!description || typeof description !== "string") {
      return NextResponse.json(
        { error: "Description is required and must be a string" },
        { status: 400 },
      );
    }

    const updatedTask = await db.task.update({
      where: {
        id: taskId,
        deleted: false,
      },
      data: {
        description: description.trim(),
      },
      select: {
        id: true,
        description: true,
        workspaceId: true,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: updatedTask,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error updating task description:", error);

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2025"
    ) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to update task description" },
      { status: 500 },
    );
  }
}
