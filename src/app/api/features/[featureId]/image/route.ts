/**
 * GET /api/features/[featureId]/image?path=features/...
 *
 * Generates a fresh presigned S3 download URL for a feature screenshot.
 * Stores the S3 path (not an expiring URL) and resolves a new URL on each request.
 *
 * Returns:
 * {
 *   "url": "https://s3.../fresh-presigned-url",
 *   "expiresIn": 3600
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { getS3Service } from "@/services/s3";
import { validateWorkspaceAccessById } from "@/services/workspace";

export const fetchCache = "force-no-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const { featureId } = await params;

    if (!featureId) {
      return NextResponse.json({ error: "Feature ID required" }, { status: 400 });
    }

    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Look up the feature
    const feature = await db.feature.findFirst({
      where: { id: featureId, deleted: false },
      select: { id: true, workspaceId: true },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    // Validate user has access to the workspace
    const accessValidation = await validateWorkspaceAccessById(feature.workspaceId, session.user.id);
    if (!accessValidation.hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Validate path query param
    const { searchParams } = new URL(request.url);
    const path = searchParams.get("path");

    if (!path) {
      return NextResponse.json({ error: "path query parameter is required" }, { status: 400 });
    }

    // Path-traversal guard: only allow paths scoped to features/
    if (!path.startsWith("features/")) {
      return NextResponse.json({ error: "Invalid path: must start with 'features/'" }, { status: 400 });
    }

    // Generate fresh presigned URL (1 hour expiration)
    const expiresIn = 3600;
    const url = await getS3Service().generatePresignedDownloadUrl(path, expiresIn);

    return NextResponse.json({ url, expiresIn });
  } catch (error) {
    console.error("Error generating feature image URL:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
