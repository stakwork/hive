import { NextRequest, NextResponse } from "next/server";
import { createWorkspace, getUserWorkspaces, softDeleteWorkspace } from "@/services/workspace";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuthOrUnauthorized } from "@/types/middleware";

// Prevent caching of user-specific data
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuthOrUnauthorized(context);
  if (userOrResponse instanceof Response) return userOrResponse;

  const workspaces = await getUserWorkspaces(userOrResponse.id);
  return NextResponse.json({ workspaces }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuthOrUnauthorized(context);
  if (userOrResponse instanceof Response) return userOrResponse;

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
      ownerId: userOrResponse.id,
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
  const userOrResponse = requireAuthOrUnauthorized(context);
  if (userOrResponse instanceof Response) return userOrResponse;

  // Find the workspace owned by this user
  const workspace = await db.workspace.findFirst({
    where: { ownerId: userOrResponse.id, deleted: false },
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
