import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getS3Service } from "@/services/s3";

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
    const { contentType, filename, fileSize } = body;

    if (!contentType || !filename || !fileSize) {
      return NextResponse.json(
        { error: "contentType, filename, and fileSize are required" },
        { status: 400 }
      );
    }

    // Validate file type and size
    const s3Service = getS3Service();

    if (!s3Service.validateWorkspaceImageType(contentType)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed types: JPEG, PNG, GIF, WebP" },
        { status: 400 }
      );
    }

    if (!s3Service.validateWorkspaceImageSize(fileSize)) {
      return NextResponse.json(
        { error: "File size exceeds 5MB limit" },
        { status: 400 }
      );
    }

    // Generate S3 key and pre-signed upload URL
    const s3Key = s3Service.generateWorkspaceImagePath(workspace.id, filename);
    const uploadUrl = await s3Service.generatePresignedUploadUrl(
      s3Key,
      contentType,
      900 // 15 minutes
    );

    return NextResponse.json({
      uploadUrl,
      s3Key,
      expiresIn: 900,
    });
  } catch (error) {
    console.error("Error generating upload URL:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
