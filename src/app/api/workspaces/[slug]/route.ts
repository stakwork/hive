import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth, checkIsSuperAdmin } from "@/lib/middleware/utils";
import {
  getWorkspaceBySlug,
  getPublicWorkspaceBySlug,
  deleteWorkspaceBySlug,
  updateWorkspace,
} from "@/services/workspace";
import { updateWorkspaceSchema } from "@/lib/schemas/workspace";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 },
      );
    }

    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);

    // Authenticated path.
    // Deny-then-elevate: first attempt is a pure membership check (no
    // allowPublicViewer) so that non-members — including super admins —
    // always resolve to null here and reach the elevate branch.
    // Owners/members return immediately without paying checkIsSuperAdmin.
    if (!(userOrResponse instanceof NextResponse)) {
      const userId = userOrResponse.id;

      // Step 1: pure membership lookup — non-null only for owner/member.
      let workspace = await getWorkspaceBySlug(slug, userId);

      if (!workspace) {
        // Step 2: caller is a non-member; check super-admin status.
        const isSuperAdmin = await checkIsSuperAdmin(userId);
        if (isSuperAdmin) {
          // Super admin → OWNER-shape workspace, bypassing membership.
          workspace = await getWorkspaceBySlug(slug, userId, { isSuperAdmin: true });
        } else {
          // Ordinary non-member → fall back to public-viewer shape so
          // workspaces flagged `isPublicViewable` still work as before.
          workspace = await getWorkspaceBySlug(slug, userId, { allowPublicViewer: true });
        }
      }

      if (!workspace) {
        return NextResponse.json(
          { error: "Workspace not found or access denied" },
          { status: 404 },
        );
      }
      return NextResponse.json({ workspace });
    }

    // Unauthenticated — fall back to public workspace check
    const workspace = await getPublicWorkspaceBySlug(slug);
    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }
    return NextResponse.json({ workspace });
  } catch (error) {
    console.error("Error fetching workspace by slug:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 },
      );
    }

    await deleteWorkspaceBySlug(slug, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting workspace:", error);

    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status =
      error instanceof Error &&
      (error.message.includes("not found") ||
        error.message.includes("access denied"))
        ? 404
        : error instanceof Error &&
            error.message.includes("Only workspace owners")
          ? 403
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 },
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = updateWorkspaceSchema.parse(body);

    const isSuperAdmin = await checkIsSuperAdmin(userId);

    // Update the workspace (super-admin bypass threaded through so non-member
    // super admins can update any workspace with owner-level rights)
    const updatedWorkspace = await updateWorkspace(slug, userId, validatedData, { isSuperAdmin });

    return NextResponse.json({ 
      workspace: updatedWorkspace,
      // Include the new slug if it changed for client-side redirect
      slugChanged: validatedData.slug !== slug ? validatedData.slug : null
    });
  } catch (error) {
    console.error("Error updating workspace:", error);

    // Handle validation errors
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Internal server error";

    let status = 500;
    if (error instanceof Error) {
      if (error.message.includes("not found") || error.message.includes("access denied")) {
        status = 404;
      } else if (
        error.message.includes("Only workspace owners") ||
        error.message.includes("owners and admins") ||
        error.message.includes("insufficient permissions") ||
        error.message.toLowerCase().includes("forbidden")
      ) {
        status = 403;
      } else if (error.message.includes("already exists")) {
        status = 409;
      }
    }
    return NextResponse.json({ error: message }, { status });
  }
}
