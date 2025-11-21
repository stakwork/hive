import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getErrorMessage } from "@/lib/utils/error";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || !(session.user as { id?: string }).id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    if (!slug) {
      return NextResponse.json(
        { success: false, error: "Slug parameter is required" },
        { status: 400 }
      );
    }

    // Check if workspace with this slug already exists
    const existingWorkspace = await db.workspace.findUnique({
      where: { slug: slug.toLowerCase() },
      select: { id: true },
    });

    const isAvailable = !existingWorkspace;

    return NextResponse.json({
      success: true,
      data: {
        slug,
        isAvailable,
        message: isAvailable
          ? "Slug is available"
          : "A workspace with this slug already exists"
      }
    });

  } catch (error: unknown) {
    const message = getErrorMessage(error, "Failed to check slug availability");
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}