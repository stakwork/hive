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
    const { rawTranscript, preVoiceText, finalText, surface, workspaceId, orgGithubLogin } = body;

    if (!isValidSurface(surface)) {
      return NextResponse.json(
        {
          error: `Invalid surface. Must be one of: ${VALID_SURFACES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Normalize workspaceId — treat "", undefined, null all as absent
    let resolvedWorkspaceId: string | null = (workspaceId ?? "").trim() || null;

    // IDOR guard: verify workspace membership if workspaceId is supplied
    if (resolvedWorkspaceId) {
      const membership = await db.workspaceMember.findFirst({
        where: { workspaceId: resolvedWorkspaceId, userId, leftAt: null },
      });
      if (!membership) {
        return NextResponse.json(
          { error: "Forbidden: not a member of this workspace" },
          { status: 403 },
        );
      }
    }

    // Resolve org default workspace when no workspaceId is available (e.g. org canvas)
    if (!resolvedWorkspaceId && (orgGithubLogin ?? "").trim()) {
      const org = await db.sourceControlOrg.findFirst({
        where: { githubLogin: orgGithubLogin.trim() },
        select: { defaultWorkspaceId: true },
      });
      const candidateId = org?.defaultWorkspaceId ?? null;

      // IDOR guard: verify the caller is a member of the resolved workspace before using it
      if (candidateId) {
        const membership = await db.workspaceMember.findFirst({
          where: { workspaceId: candidateId, userId, leftAt: null },
        });
        resolvedWorkspaceId = membership ? candidateId : null;
      }
    }

    // FK existence guard — defense in depth against stale/deleted workspace ids
    if (resolvedWorkspaceId) {
      const ws = await db.workspace.findUnique({
        where: { id: resolvedWorkspaceId },
        select: { id: true },
      });
      if (!ws) {
        resolvedWorkspaceId = null; // FK would fail — fall back to null
      }
    }

    const record = await db.voiceCorrectionLearning.create({
      data: {
        userId,
        workspaceId: resolvedWorkspaceId,
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
    // Fire-and-forget endpoint — never surface a 500 to the client
    logger.error("Voice correction capture failed — swallowed", "VOICE_CORRECTION_ERROR", error);
    return NextResponse.json({ skipped: true }, { status: 200 });
  }
}
