import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { createWorkspace, getWorkspacesByUserId, softDeleteWorkspace } from "@/services/workspace";
import { db } from "@/lib/db";

// Prevent caching of user-specific data
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const workspaces = await getWorkspacesByUserId(userId);
  return NextResponse.json({ workspaces }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
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
      ownerId: userId,
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

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
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
