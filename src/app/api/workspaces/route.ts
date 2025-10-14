import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { createWorkspace, getUserWorkspaces, softDeleteWorkspace } from "@/services/workspace";
import { db } from "@/lib/db";
import { unauthorized, badRequest, notFound } from "@/types/errors";
import { handleApiError } from "@/lib/api/errors";

// Prevent caching of user-specific data
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as { id?: string }).id) {
      throw unauthorized("Unauthorized");
    }
    const userId = (session.user as { id: string }).id;
    const workspaces = await getUserWorkspaces(userId);
    return NextResponse.json({ workspaces }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as { id?: string }).id) {
      throw unauthorized("Unauthorized");
    }
    const userId = (session.user as { id: string }).id;
    const body = await request.json();
    const { name, description, slug } = body;
    if (!name || !slug) {
      throw badRequest("Missing required fields");
    }
    const workspace = await createWorkspace({
      name,
      description,
      slug,
      ownerId: userId,
    });
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as { id?: string }).id) {
      throw unauthorized("Unauthorized");
    }
    const userId = (session.user as { id: string }).id;
    const workspace = await db.workspace.findFirst({
      where: { ownerId: userId, deleted: false },
    });
    if (!workspace) {
      throw notFound("No workspace found for user");
    }
    await softDeleteWorkspace(workspace.id);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
