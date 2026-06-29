import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isValidTimezone } from "@/lib/automations/schedule";

/**
 * Authenticated user's UI preferences. Currently:
 * - `canvasAutonomousTurns` — the per-user opt-in for the autonomous
 *   canvas-agent turns (see `src/services/canvas-agent-autoturn.ts`).
 * - `chatAgentModel` — the per-user default model for the canvas Agent
 *   chat, in `getModelValue()` "provider/name" form. Null = inherit the
 *   admin-configured default.
 * Both are edited from the gear menu on the canvas Agent chat panel.
 */

/** GET /api/user/preferences — read the current user's preferences. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { canvasAutonomousTurns: true, chatAgentModel: true, timezone: true, dailyRecapEnabled: true, voiceLearningEnabled: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    canvasAutonomousTurns: user.canvasAutonomousTurns,
    chatAgentModel: user.chatAgentModel,
    timezone: user.timezone ?? "UTC",
    dailyRecapEnabled: user.dailyRecapEnabled,
    voiceLearningEnabled: user.voiceLearningEnabled,
  });
}

/** PATCH /api/user/preferences — update one or more preference flags. */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { canvasAutonomousTurns, chatAgentModel, timezone, dailyRecapEnabled, voiceLearningEnabled } = body;

    if (
      canvasAutonomousTurns !== undefined &&
      typeof canvasAutonomousTurns !== "boolean"
    ) {
      return NextResponse.json(
        { error: "canvasAutonomousTurns must be a boolean" },
        { status: 400 },
      );
    }

    if (
      chatAgentModel !== undefined &&
      chatAgentModel !== null &&
      typeof chatAgentModel !== "string"
    ) {
      return NextResponse.json(
        { error: "chatAgentModel must be a string or null" },
        { status: 400 },
      );
    }

    if (timezone !== undefined) {
      if (typeof timezone !== "string" || !isValidTimezone(timezone)) {
        return NextResponse.json(
          { error: "Invalid IANA timezone" },
          { status: 400 },
        );
      }
    }

    if (dailyRecapEnabled !== undefined && typeof dailyRecapEnabled !== "boolean") {
      return NextResponse.json(
        { error: "dailyRecapEnabled must be a boolean" },
        { status: 400 },
      );
    }

    if (voiceLearningEnabled !== undefined && typeof voiceLearningEnabled !== "boolean") {
      return NextResponse.json(
        { error: "voiceLearningEnabled must be a boolean" },
        { status: 400 },
      );
    }

    const updated = await db.user.update({
      where: { id: session.user.id },
      data: {
        ...(canvasAutonomousTurns !== undefined && { canvasAutonomousTurns }),
        ...(chatAgentModel !== undefined && { chatAgentModel }),
        ...(timezone !== undefined && { timezone }),
        ...(dailyRecapEnabled !== undefined && { dailyRecapEnabled }),
        ...(voiceLearningEnabled !== undefined && { voiceLearningEnabled }),
      },
      select: { canvasAutonomousTurns: true, chatAgentModel: true, timezone: true, dailyRecapEnabled: true, voiceLearningEnabled: true },
    });

    logger.info("User preferences updated", "USER_PREFERENCES_UPDATE", {
      userId: session.user.id,
      canvasAutonomousTurns: updated.canvasAutonomousTurns,
      chatAgentModel: updated.chatAgentModel,
      timezone: updated.timezone,
      dailyRecapEnabled: updated.dailyRecapEnabled,
      voiceLearningEnabled: updated.voiceLearningEnabled,
    });

    return NextResponse.json({
      canvasAutonomousTurns: updated.canvasAutonomousTurns,
      chatAgentModel: updated.chatAgentModel,
      timezone: updated.timezone ?? "UTC",
      dailyRecapEnabled: updated.dailyRecapEnabled,
      voiceLearningEnabled: updated.voiceLearningEnabled,
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
