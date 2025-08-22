import { NextRequest, NextResponse } from "next/server";
import { createWorkspace, getUserWorkspaces, softDeleteWorkspace } from "@/services/workspace";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/types/middleware";

// Prevent caching of user-specific data
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = getMiddlewareContext(request);
  const user = requireAuth(context);
  
  const workspaces = await getUserWorkspaces(user.id);
  return NextResponse.json({ workspaces }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const context = getMiddlewareContext(request);
  const user = requireAuth(context);
  const body = await request.json();
  const { name, description, slug } = body;
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
      ownerId: user.id,
    });
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error: unknown) {
    const message =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Failed to create workspace.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const context = getMiddlewareContext(request);
  const user = requireAuth(context);
  
  // Find the workspace owned by this user
  const workspace = await db.workspace.findFirst({
    where: { ownerId: user.id, deleted: false },
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
