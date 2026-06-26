import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as { id?: string })?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, versionId } = await params;

    // IDOR: verify prompt belongs to a workspace the user can access
    const version = await db.promptVersion.findFirst({
      where: { id: versionId, promptId: id },
      include: {
        prompt: {
          select: {
            id: true,
            name: true,
            workspaceId: true,
            workspace: { select: { ownerId: true } },
          },
        },
      },
    });

    if (!version) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { workspaceId, workspace } = version.prompt;
    const member = await db.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });
    if (!member && workspace.ownerId !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: version.id,
        prompt_id: version.promptId,
        version_number: version.versionNumber,
        name: version.prompt.name,
        value: version.value,
        description: version.description ?? "",
        published: version.published,
        created_at: version.createdAt.toISOString(),
        whodunnit: version.whodunnit,
      },
    });
  } catch (error) {
    console.error("Error fetching prompt version:", error);
    return NextResponse.json({ error: "Failed to fetch prompt version" }, { status: 500 });
  }
}
