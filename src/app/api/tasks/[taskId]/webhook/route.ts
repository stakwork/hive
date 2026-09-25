import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  authenticateCallbackRequest,
  authorizeCallbackTargets,
  isValidGitBranchName,
  CALLBACK_MAX_SUMMARY_LENGTH,
} from "@/lib/auth/callback-access";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    // Authenticate first — before the body is parsed. Accepts the system
    // API_TOKEN (unchanged behaviour) or an org hiveorg_… key.
    const caller = await authenticateCallbackRequest(request);
    if (caller instanceof NextResponse) return caller;

    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json(
        { error: "Task ID is required" },
        { status: 400 },
      );
    }

    // Authorize the target task before any lookup/update. System callers
    // pass straight through with no DB reads; org callers are scoped to
    // their org's workspace(s), resolved from the task record itself.
    const authorized = await authorizeCallbackTargets(caller, { taskId });
    if (authorized instanceof NextResponse) return authorized;

    const body = await request.json();
    const { branch, summary } = body;

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
    const updateData: Record<string, string | null> = {};

    if (branch !== undefined) {
      if (typeof branch !== "string") {
        return NextResponse.json(
          { error: "Branch must be a string" },
          { status: 400 },
        );
      }
      const trimmedBranch = branch.trim();
      if (authorized.caller.kind === "org" && !isValidGitBranchName(trimmedBranch)) {
        console.warn("[tasks/webhook] rejected", {
          reason: "invalid_branch",
          orgId: authorized.caller.orgId,
          apiKeyId: authorized.caller.apiKeyId,
          taskId,
        });
        return NextResponse.json(
          { error: "Invalid branch name" },
          { status: 400 },
        );
      }
      updateData.branch = trimmedBranch;
    }

    if (summary !== undefined) {
      if (summary !== null && typeof summary !== "string") {
        return NextResponse.json(
          { error: "Summary must be a string or null" },
          { status: 400 },
        );
      }
      if (
        authorized.caller.kind === "org" &&
        typeof summary === "string" &&
        summary.length > CALLBACK_MAX_SUMMARY_LENGTH
      ) {
        console.warn("[tasks/webhook] rejected", {
          reason: "invalid_summary",
          orgId: authorized.caller.orgId,
          apiKeyId: authorized.caller.apiKeyId,
          taskId,
        });
        return NextResponse.json(
          { error: "Summary too long" },
          { status: 400 },
        );
      }
      // Allow null or empty string to clear the field, otherwise trim
      updateData.summary = summary === null || summary === "" ? null : summary.trim();
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
        summary: true,
        workspaceId: true,
      },
    });

    console.info("[tasks/webhook] success", {
      callerKind: authorized.caller.kind,
      orgId: authorized.caller.kind === "org" ? authorized.caller.orgId : undefined,
      apiKeyId: authorized.caller.kind === "org" ? authorized.caller.apiKeyId : undefined,
      workspaceId: updatedTask.workspaceId,
      taskId,
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
