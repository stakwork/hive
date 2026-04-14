import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";

/**
 * PATCH — toggle scorer enabled + edit prompts for a workspace.
 * Body: { scorerEnabled?: boolean, scorerPatternPrompt?: string | null, scorerSinglePrompt?: string | null }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id: workspaceId } = await params;

  try {
    const body = await request.json();
    const { scorerEnabled, scorerPatternPrompt, scorerSinglePrompt } = body as {
      scorerEnabled?: boolean;
      scorerPatternPrompt?: string | null;
      scorerSinglePrompt?: string | null;
    };

    const data: Record<string, unknown> = {};
    if (typeof scorerEnabled === "boolean") data.scorerEnabled = scorerEnabled;
    if (scorerPatternPrompt !== undefined)
      data.scorerPatternPrompt = scorerPatternPrompt;
    if (scorerSinglePrompt !== undefined)
      data.scorerSinglePrompt = scorerSinglePrompt;

    const workspace = await db.workspace.update({
      where: { id: workspaceId },
      data,
      select: {
        id: true,
        name: true,
        slug: true,
        scorerEnabled: true,
        scorerPatternPrompt: true,
        scorerSinglePrompt: true,
      },
    });

    return NextResponse.json(workspace);
  } catch (error) {
    console.error("Error updating workspace scorer config:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
