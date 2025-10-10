import { NextResponse } from "next/server";
import { getWorkspaceMembers, addWorkspaceMember } from "@/services/workspace";
import { isAssignableMemberRole } from "@/lib/auth/roles";

export const runtime = "nodejs";

// GET /api/workspaces/[slug]/members - Get all workspace members
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await params;
    const userId = request.headers.get("x-middleware-user-id");
    const workspaceId = request.headers.get("x-middleware-workspace-id");

    if (!userId || !workspaceId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await getWorkspaceMembers(workspaceId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching workspace members:", error);
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
  }
}

// POST /api/workspaces/[slug]/members - Add a member to workspace
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await params;
    const userId = request.headers.get("x-middleware-user-id");
    const workspaceId = request.headers.get("x-middleware-workspace-id");
    const canAdmin = request.headers.get("x-middleware-can-admin");
    const body = await request.json();

    const { githubUsername, role } = body;

    if (!userId || !workspaceId || canAdmin !== "true") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    if (!githubUsername || !role) {
      return NextResponse.json({ error: "GitHub username and role are required" }, { status: 400 });
    }

    // Validate role
    if (!isAssignableMemberRole(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const member = await addWorkspaceMember(workspaceId, githubUsername, role);
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
    return NextResponse.json({ error: "Failed to add member" }, { status: 500 });
  }
}
