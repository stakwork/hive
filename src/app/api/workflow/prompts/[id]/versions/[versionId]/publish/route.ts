import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { publishVersion } from "@/services/prompts/prompt-sync";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as { id?: string })?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, versionId } = await params;

    // Resolve workspace for IDOR
    const prompt = await db.prompt.findUnique({
      where: { id },
      select: { workspaceId: true, workspace: { select: { ownerId: true } } },
    });
    if (!prompt) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const member = await db.workspaceMember.findFirst({
      where: { workspaceId: prompt.workspaceId, userId },
    });
    if (!member && prompt.workspace.ownerId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await publishVersion(id, versionId, prompt.workspaceId);

    // Optionally update artifact published state (keep backwards compat)
    const body = await request.json().catch(() => ({})) as { artifactId?: string };
    if (body.artifactId) {
      await updateArtifactPublished(body.artifactId, prompt.workspaceId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const e = error as { code?: string; message?: string };
    if (e.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("Error publishing prompt version:", error);
    return NextResponse.json({ error: "Failed to publish prompt version" }, { status: 500 });
  }
}

async function updateArtifactPublished(
  artifactId: string,
  workspaceId: string,
): Promise<void> {
  try {
    const artifact = await db.artifact.findUnique({
      where: { id: artifactId },
      include: { message: { include: { task: { select: { workspaceId: true } } } } },
    });
    if (!artifact) return;
    if (artifact.message?.task?.workspaceId !== workspaceId) return;

    const current = (artifact.content as Record<string, unknown>) ?? {};
    await db.artifact.update({
      where: { id: artifactId },
      data: { content: { ...current, published: true } },
    });
  } catch (err) {
    console.error("Error updating artifact published state:", err);
  }
}
