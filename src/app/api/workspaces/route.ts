import { NextRequest, NextResponse } from "next/server";
import { requireAuthFromRequest } from "@/lib/api/auth-helpers";
import { createWorkspace, getUserWorkspaces, softDeleteWorkspace } from "@/services/workspace";
import { db } from "@/lib/db";
import { getErrorMessage } from "@/lib/utils/error";

// Prevent caching of user-specific data
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { error, userId } = requireAuthFromRequest(request);
  if (error) return error;

  const workspaces = await getUserWorkspaces(userId);
  return NextResponse.json({ workspaces }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const { error, userId } = requireAuthFromRequest(request);
  if (error) return error;

  const body = await request.json();
  const { name, description, slug, repositoryUrl } = body;
  if (!name || !slug) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }
  try {
    const workspace = await createWorkspace({
      name,
      description,
      slug,
      ownerId: userId,
      repositoryUrl,
    });
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error: unknown) {
    const message = getErrorMessage(error, "Failed to create workspace.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const { error, userId } = requireAuthFromRequest(request);
  if (error) return error;

  // Find the workspace owned by this user
  const workspace = await db.workspace.findFirst({
    where: { ownerId: userId, deleted: false },
  });
  if (!workspace) {
    return NextResponse.json(
      { error: "No workspace found for user" },
      { status: 404 },
    );
  }
  await softDeleteWorkspace(workspace.id);
  return NextResponse.json({ success: true }, { status: 200 });
}
