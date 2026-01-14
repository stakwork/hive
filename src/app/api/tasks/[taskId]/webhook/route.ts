import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    // Validate API token
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
    const { branch } = body;

    // Validate task exists
    const task = await db.task.findFirst({
      where: {
        id: taskId,
        deleted: false,
      },
      select: {
        id: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Build update data from provided fields
    const updateData: Record<string, string> = {};

    if (branch !== undefined) {
      if (typeof branch !== "string") {
        return NextResponse.json(
          { error: "Branch must be a string" },
          { status: 400 },
        );
      }
      updateData.branch = branch.trim();
    }

    // Require at least one field to update
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    // Update task
    const updatedTask = await db.task.update({
      where: { id: taskId },
      data: updateData,
      select: {
        id: true,
        title: true,
        branch: true,
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
    console.error("Error updating task via webhook:", error);

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to update task" },
      { status: 500 },
    );
  }
}
