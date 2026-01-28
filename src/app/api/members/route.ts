import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  addWorkspaceMember,
  updateWorkspaceMemberRole,
  removeWorkspaceMember,
} from "@/services/workspace";
import { findUserByGitHubUsername } from "@/lib/helpers/workspace-member-queries";
import { WorkspaceRole } from "@prisma/client";

const ALLOWED_ROLES: WorkspaceRole[] = [
  WorkspaceRole.VIEWER,
  WorkspaceRole.STAKEHOLDER,
  WorkspaceRole.DEVELOPER,
];

function validateApiToken(request: NextRequest): boolean {
  const apiToken = request.headers.get("x-api-token");
  return !!apiToken && apiToken === process.env.API_TOKEN;
}

async function getWorkspaceById(workspaceId: string) {
  return db.workspace.findUnique({
    where: { id: workspaceId, deleted: false },
    select: { id: true, ownerId: true },
  });
}

async function getUserIdByGitHubUsername(
  githubUsername: string
): Promise<string | null> {
  const githubAuth = await findUserByGitHubUsername(githubUsername);
  return githubAuth?.userId ?? null;
}

// POST - Add member
export async function POST(request: NextRequest) {
  if (!validateApiToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { workspaceId, githubUsername, role = "VIEWER" } = body;

    if (!workspaceId || !githubUsername) {
      return NextResponse.json(
        { error: "workspaceId and githubUsername are required" },
        { status: 400 }
      );
    }

    if (!ALLOWED_ROLES.includes(role as WorkspaceRole)) {
      return NextResponse.json(
        { error: "Invalid role. Allowed: VIEWER, STAKEHOLDER, DEVELOPER" },
        { status: 400 }
      );
    }

    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const member = await addWorkspaceMember(
      workspaceId,
      githubUsername,
      role as WorkspaceRole
    );
    return NextResponse.json({ success: true, member }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to add member";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// PATCH - Update member role
export async function PATCH(request: NextRequest) {
  if (!validateApiToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { workspaceId, githubUsername, role } = body;

    if (!workspaceId || !githubUsername || !role) {
      return NextResponse.json(
        { error: "workspaceId, githubUsername, and role are required" },
        { status: 400 }
      );
    }

    if (!ALLOWED_ROLES.includes(role as WorkspaceRole)) {
      return NextResponse.json(
        { error: "Invalid role. Allowed: VIEWER, STAKEHOLDER, DEVELOPER" },
        { status: 400 }
      );
    }

    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const userId = await getUserIdByGitHubUsername(githubUsername);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const member = await updateWorkspaceMemberRole(
      workspaceId,
      userId,
      role as WorkspaceRole
    );
    return NextResponse.json({ success: true, member });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update member";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE - Remove member
export async function DELETE(request: NextRequest) {
  if (!validateApiToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { workspaceId, githubUsername } = body;

    if (!workspaceId || !githubUsername) {
      return NextResponse.json(
        { error: "workspaceId and githubUsername are required" },
        { status: 400 }
      );
    }

    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const userId = await getUserIdByGitHubUsername(githubUsername);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (workspace.ownerId === userId) {
      return NextResponse.json(
        { error: "Cannot remove workspace owner" },
        { status: 400 }
      );
    }

    await removeWorkspaceMember(workspaceId, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to remove member";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
