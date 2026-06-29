import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const VALID_SURFACES = [
  "task_chat",
  "plan_chat",
  "plan_start",
  "task_start",
  "whiteboard",
  "sidebar",
] as const;

type VoiceSurface = (typeof VALID_SURFACES)[number];

function isValidSurface(value: unknown): value is VoiceSurface {
  return typeof value === "string" && (VALID_SURFACES as readonly string[]).includes(value);
}

/** POST /api/voice-corrections — record a voice correction learning event. */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    const body = await request.json();
    const { rawTranscript, preVoiceText, finalText, surface, workspaceId } = body;

    if (!isValidSurface(surface)) {
      return NextResponse.json(
        {
          error: `Invalid surface. Must be one of: ${VALID_SURFACES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // IDOR guard: verify workspace membership if workspaceId is supplied
    if (workspaceId) {
      const membership = await db.workspaceMember.findFirst({
        where: { workspaceId, userId, leftAt: null },
      });
      if (!membership) {
        return NextResponse.json(
          { error: "Forbidden: not a member of this workspace" },
          { status: 403 },
        );
      }
    }

    const record = await db.voiceCorrectionLearning.create({
      data: {
        userId,
        workspaceId: workspaceId ?? null,
        surface,
        rawTranscript: rawTranscript ?? "",
        preVoiceText: preVoiceText ?? "",
        finalText: finalText ?? "",
      },
    });

    logger.info("Voice correction recorded", "VOICE_CORRECTION_CREATE", {
      id: record.id,
      userId,
      surface,
    });

    return NextResponse.json({ id: record.id }, { status: 201 });
  } catch (error) {
    logger.error(
      "Failed to record voice correction",
      "VOICE_CORRECTION_ERROR",
      error,
    );
    return NextResponse.json(
      { error: "Failed to record correction" },
      { status: 500 },
    );
  }
}
