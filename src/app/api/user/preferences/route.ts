import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Authenticated user's UI preferences. Currently a single flag:
 * `canvasAutonomousTurns` — the per-user opt-in for the autonomous
 * canvas-agent turns (see `src/services/canvas-agent-autoturn.ts`).
 * Toggled from the gear menu on the canvas Agent chat panel.
 */

/** GET /api/user/preferences — read the current user's preferences. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { canvasAutonomousTurns: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ canvasAutonomousTurns: user.canvasAutonomousTurns });
}

/** PATCH /api/user/preferences — update one or more preference flags. */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { canvasAutonomousTurns } = body;

    if (
      canvasAutonomousTurns !== undefined &&
      typeof canvasAutonomousTurns !== "boolean"
    ) {
      return NextResponse.json(
        { error: "canvasAutonomousTurns must be a boolean" },
        { status: 400 },
      );
    }

    const updated = await db.user.update({
      where: { id: session.user.id },
      data: {
        ...(canvasAutonomousTurns !== undefined && { canvasAutonomousTurns }),
      },
      select: { canvasAutonomousTurns: true },
    });

    logger.info("User preferences updated", "USER_PREFERENCES_UPDATE", {
      userId: session.user.id,
      canvasAutonomousTurns: updated.canvasAutonomousTurns,
    });

    return NextResponse.json({
      canvasAutonomousTurns: updated.canvasAutonomousTurns,
    });
  } catch (error) {
    logger.error(
      "Failed to update user preferences",
      "USER_PREFERENCES_UPDATE_ERROR",
      error,
    );
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 },
    );
  }
}
