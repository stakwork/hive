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

export const runtime = "nodejs";

// GET /api/workspaces/[slug]/members - Get all workspace members
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const userId = (session.user as { id: string }).id;

    // Check workspace access
    const workspace = await getWorkspaceBySlug(slug, userId);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
    }

    const result = await getWorkspaceMembers(workspace.id);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching workspace members:", error);
    return NextResponse.json(
      { error: "Failed to fetch members" },
      { status: 500 }
    );
  }
}

// POST /api/workspaces/[slug]/members - Add a member to workspace
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const userId = (session.user as { id: string }).id;
    const body = await request.json();

    const { githubUsername, role } = body;

    if (!githubUsername || !role) {
      return NextResponse.json(
        { error: "GitHub username and role are required" },
        { status: 400 }
      );
    }

    // Validate role
    if (!isAssignableMemberRole(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    // Check workspace access and admin permissions
    const access = await validateWorkspaceAccess(slug, userId);
    if (!access.hasAccess || !access.canAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    if (!access.workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const member = await addWorkspaceMember(access.workspace.id, githubUsername, role);
    return NextResponse.json({ member }, { status: 201 });
  } catch (error: unknown) {
    console.error("Error adding workspace member:", error);
    
    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      
      if (error.message.includes("already a member") || error.message.includes("Cannot add")) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    return NextResponse.json(
      { error: "Failed to add member" },
      { status: 500 }
    );
  }
}