import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getS3Service } from "@/services/s3";
import { db } from "@/lib/db";

export async function GET(
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

    // Any workspace member can view the image
    if (!workspace.imageS3Key) {
      return NextResponse.json({ imageUrl: null });
    }

    // Generate pre-signed download URL
    const s3Service = getS3Service();
    const imageUrl = await s3Service.generatePresignedDownloadUrl(
      workspace.imageS3Key,
      3600 // 1 hour
    );

    return NextResponse.json({ imageUrl });
  } catch (error) {
    console.error("Error retrieving workspace image:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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
        { error: "Only workspace admins and owners can delete images" },
        { status: 403 }
      );
    }

    // Check if workspace has an image
    if (!workspace.imageS3Key) {
      return NextResponse.json(
        { error: "Workspace has no image to delete" },
        { status: 404 }
      );
    }

    // Delete from S3
    const s3Service = getS3Service();
    await s3Service.deleteObject(workspace.imageS3Key);

    // Clear imageS3Key from database
    await db.workspace.update({
      where: { id: workspace.id },
      data: { imageS3Key: null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting workspace image:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
