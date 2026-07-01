import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { isDevelopmentMode } from "@/lib/runtime";
import { publishVersion } from "@/services/prompts/prompt-sync";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const devMode = isDevelopmentMode();

    // Auth: require stakwork workspace membership for writes
    let workspaceId: string | null = null;
    if (!devMode) {
      const workspace = await db.workspace.findFirst({
        where: {
          slug: "stakwork",
          OR: [{ ownerId: userId }, { members: { some: { userId } } }],
        },
      });
      if (!workspace) {
        return NextResponse.json(
          { error: "Access denied - not a member of stakwork workspace" },
          { status: 403 },
        );
      }
      workspaceId = workspace.id;
    }

    const { id, versionId } = await params;
    if (!id) {
      return NextResponse.json({ error: "Prompt ID is required" }, { status: 400 });
    }
    if (!versionId) {
      return NextResponse.json({ error: "Version ID is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({})) as { artifactId?: string };
    const { artifactId } = body;

    // Publish the version in Hive (+ best-effort Stakwork push inside service)
    await publishVersion(id, versionId);

    // Optionally update artifact published state
    if (artifactId) {
      await updateArtifactPublished(artifactId, workspaceId, devMode);
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("Error publishing prompt version:", err);
    return NextResponse.json({ error: "Failed to publish prompt version" }, { status: 500 });
  }
}

async function updateArtifactPublished(
  artifactId: string,
  workspaceId: string | null,
  devMode: boolean,
): Promise<void> {
  try {
    const artifact = await db.artifact.findUnique({
      where: { id: artifactId },
      include: {
        message: {
          include: {
            task: { select: { workspaceId: true } },
          },
        },
      },
    });
    if (!artifact) return;

    const artifactWorkspaceId = artifact.message?.task?.workspaceId;
    const callerHasAccess = devMode || (workspaceId && artifactWorkspaceId === workspaceId);
    if (!callerHasAccess) return;

    const current = (artifact.content as Record<string, unknown>) ?? {};
    await db.artifact.update({
      where: { id: artifactId },
      data: { content: { ...current, published: true } },
    });
  } catch (err) {
    console.error("Error updating artifact published state:", err);
  }
}
