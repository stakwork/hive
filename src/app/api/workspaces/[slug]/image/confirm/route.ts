import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getS3Service } from "@/services/s3";
import { db } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const workspace = await getWorkspaceBySlug(slug, userId);

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    // Check if user is ADMIN or OWNER
    if (workspace.userRole !== "ADMIN" && workspace.userRole !== "OWNER") {
      return NextResponse.json(
        { error: "Only workspace admins and owners can upload images" },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { s3Key } = body;

    if (!s3Key) {
      return NextResponse.json(
        { error: "s3Key is required" },
        { status: 400 }
      );
    }

    // Delete old image if exists
    if (workspace.imageS3Key) {
      try {
        const s3Service = getS3Service();
        await s3Service.deleteObject(workspace.imageS3Key);
      } catch (error) {
        console.error("Error deleting old workspace image:", error);
        // Continue anyway - don't fail the upload if old image deletion fails
      }
    }

    // Update workspace with new image key
    await db.workspace.update({
      where: { id: workspace.id },
      data: { imageS3Key: s3Key },
    });

    return NextResponse.json({
      success: true,
      s3Key,
    });
  } catch (error) {
    console.error("Error confirming image upload:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
