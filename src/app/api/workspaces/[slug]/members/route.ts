import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import {
  getWorkspaceMembers,
  addWorkspaceMember,
  validateWorkspaceAccess,
  getWorkspaceBySlug,
} from "@/services/workspace";
import { isAssignableMemberRole } from "@/lib/auth/roles";
import { unauthorized, badRequest, notFound, forbidden } from "@/types/errors";
import { handleApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

// GET /api/workspaces/[slug]/members - Get all workspace members
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      throw unauthorized("Unauthorized");
    }

    const { slug } = await params;
    const userId = (session.user as { id: string }).id;

    // Check workspace access
    const workspace = await getWorkspaceBySlug(slug, userId);
    if (!workspace) {
      throw notFound("Workspace not found or access denied");
    }

    const result = await getWorkspaceMembers(workspace.id);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/workspaces/[slug]/members - Add a member to workspace
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      throw unauthorized("Unauthorized");
    }

    const { slug } = await params;
    const userId = (session.user as { id: string }).id;
    const body = await request.json();

    const { githubUsername, role } = body;

    if (!githubUsername || !role) {
      throw badRequest("GitHub username and role are required");
    }

    // Validate role
    if (!isAssignableMemberRole(role)) {
      throw badRequest("Invalid role");
    }

    // Check workspace access and admin permissions
    const access = await validateWorkspaceAccess(slug, userId);
    if (!access.hasAccess || !access.canAdmin) {
      throw forbidden("Admin access required");
    }

    if (!access.workspace) {
      throw notFound("Workspace not found");
    }

    const member = await addWorkspaceMember(access.workspace.id, githubUsername, role);
    return NextResponse.json({ member }, { status: 201 });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}