import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { createWorkspace, getWorkspacesByUserId, updateWorkspaceBySlug } from "@/services/workspace";
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
    where: { ownerId: userId },
  });
  if (!workspace) {
    return NextResponse.json(
      { error: "No workspace found for user" },
      { status: 404 },
    );
  }
  await db.workspace.delete({ where: { id: workspace.id } });
  return NextResponse.json({ success: true }, { status: 200 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const body = await request.json().catch(() => ({}));
    const { name, description, slug: newSlug } = body ?? {};

    const updated = await updateWorkspaceBySlug(slug, userId, {
      name,
      description,
      slug: newSlug,
    });

    return NextResponse.json({ workspace: updated }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update workspace";

    let status = 400;
    if (/Unauthorized|access denied/i.test(message)) status = 403;
    if (/not found/i.test(message)) status = 404;
    if (/already exists/i.test(message)) status = 409;

    return NextResponse.json({ error: message }, { status });
  }
}
