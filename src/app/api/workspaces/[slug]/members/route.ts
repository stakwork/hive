import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth/nextauth";
import {
  getWorkspaceMembers,
  addWorkspaceMember,
  validateWorkspaceAccess,
  getWorkspaceBySlug,
} from "@/services/workspace";
import { isAssignableMemberRole } from "@/lib/auth/roles";

export const runtime = "nodejs";

async function getUserId(request: NextRequest): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (session?.user && (session.user as { id?: string }).id) {
    return (session.user as { id: string }).id;
  }
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET! });
  if (token?.id && typeof token.id === "string") return token.id;
  return null;
}

// GET /api/workspaces/[slug]/members - Get all workspace members
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const { resolveWorkspaceAccess, requireReadAccess, isPublicViewer } = await import(
      "@/lib/auth/workspace-access"
    );
    const { toPublicMember } = await import("@/lib/auth/public-redact");

    const access = await resolveWorkspaceAccess(request, { slug });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;
    const redactForPublic = isPublicViewer(ok);

    // Check if system assignees should be included (defaults to false).
    // Public viewers never get the sphinxLinkedOnly filter since that leaks
    // membership-integration metadata — they see only active members.
    const url = new URL(request.url);
    const includeSystemAssignees =
      url.searchParams.get("includeSystemAssignees") === "true" && !redactForPublic;
    const sphinxLinkedOnly =
      url.searchParams.get("sphinxLinkedOnly") === "true" && !redactForPublic;

    const result = await getWorkspaceMembers(ok.workspaceId, includeSystemAssignees, sphinxLinkedOnly);

    if (redactForPublic && result && typeof result === "object" && "members" in result) {
      // Strip emails + GitHub metadata for public viewers. Shape stays
      // the same (email: null) so downstream components don't need to
      // branch on the redacted vs authenticated form.
      const sanitized = {
        ...result,
        members: (result.members as Array<Parameters<typeof toPublicMember>[0]>).map(toPublicMember),
      };
      return NextResponse.json(sanitized);
    }

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
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
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
