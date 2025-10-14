import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { unauthorized, badRequest } from "@/types/errors";
import { handleApiError } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as { id?: string }).id) {
      throw unauthorized("Unauthorized");
    }

    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    if (!slug) {
      throw badRequest("Slug parameter is required");
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
        message: isAvailable ? "Slug is available" : "A workspace with this slug already exists",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}