import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import {
  getWorkspaceBySlug,
  deleteWorkspaceBySlug,
} from "@/services/workspace";

export async function GET(
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

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 },
      );
    }

    const workspace = await getWorkspaceBySlug(slug, userId);

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
    const session = await getServerSession(authOptions);

    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
