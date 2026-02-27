import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * PATCH /api/user/profile
 * Update authenticated user's profile fields (sphinxAlias)
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { sphinxAlias } = body;

    // Validate sphinxAlias if provided
    if (sphinxAlias !== undefined && sphinxAlias !== null) {
      if (typeof sphinxAlias !== "string") {
        return NextResponse.json({ error: "sphinxAlias must be a string" }, { status: 400 });
      }

      // Trim and check length
      const trimmed = sphinxAlias.trim();
      if (trimmed.length > 50) {
        return NextResponse.json({ error: "sphinxAlias must be 50 characters or less" }, { status: 400 });
      }
    }

    // Update user
    const updatedUser = await db.user.update({
      where: { id: session.user.id },
      data: {
        sphinxAlias: sphinxAlias === null || sphinxAlias === "" ? null : sphinxAlias.trim(),
      },
      select: { sphinxAlias: true },
    });

    logger.info("User profile updated", "USER_PROFILE_UPDATE", {
      userId: session.user.id,
      sphinxAlias: updatedUser.sphinxAlias,
    });

    return NextResponse.json({ sphinxAlias: updatedUser.sphinxAlias });
  } catch (error) {
    logger.error("Failed to update user profile", "USER_PROFILE_UPDATE_ERROR", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
