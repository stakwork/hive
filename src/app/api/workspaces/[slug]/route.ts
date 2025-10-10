import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceBySlug, deleteWorkspaceBySlug, updateWorkspace } from "@/services/workspace";
import { updateWorkspaceSchema } from "@/lib/schemas/workspace";
import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (!slug) {
      return NextResponse.json({ error: "Workspace slug is required" }, { status: 400 });
    }
    const workspaceId = request.headers.get("x-middleware-workspace-id");
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const workspace = await getWorkspaceBySlug(slug, workspaceId);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    return NextResponse.json({ workspace });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);

    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json({ error: "Workspace slug is required" }, { status: 400 });
    }

    await deleteWorkspaceBySlug(slug, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting workspace:", error);

    const message = error instanceof Error ? error.message : "Internal server error";
    const status =
      error instanceof Error && (error.message.includes("not found") || error.message.includes("access denied"))
        ? 404
        : error instanceof Error && error.message.includes("Only workspace owners")
          ? 403
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const userId = request.headers.get("x-middleware-user-id");
    const { slug } = await params;
    if (!userId || !slug) {
      return NextResponse.json({ error: "Missing user or workspace context" }, { status: 400 });
    }
    const body = await request.json();
    const validatedData = updateWorkspaceSchema.parse(body);
    const updatedWorkspace = await updateWorkspace(slug, userId, validatedData);
    return NextResponse.json({
      workspace: updatedWorkspace,
      slugChanged: validatedData.slug !== slug ? validatedData.slug : null,
    });
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json({ error: "Validation failed", details: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Internal server error";

    const status =
      error instanceof Error && (error.message.includes("not found") || error.message.includes("access denied"))
        ? 404
        : error instanceof Error &&
            (error.message.includes("Only workspace owners") ||
              error.message.includes("Only workspace") ||
              error.message.includes("owners and admins"))
          ? 403
          : error instanceof Error && error.message.includes("already exists")
            ? 409
            : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
