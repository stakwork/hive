import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

async function hasAccess(promptId: string, userId: string) {
  const prompt = await db.prompt.findUnique({
    where: { id: promptId },
    select: { workspaceId: true, workspace: { select: { ownerId: true } } },
  });
  if (!prompt) return false;
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId: prompt.workspaceId, userId },
  });
  return !!(member || prompt.workspace.ownerId === userId);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as { id?: string })?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const ok = await hasAccess(id, userId);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const prompt = await db.prompt.findUnique({
      where: { id },
      select: { id: true, name: true, publishedVersionId: true },
    });
    if (!prompt) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const versions = await db.promptVersion.findMany({
      where: { promptId: id },
      orderBy: { versionNumber: "desc" },
      select: {
        id: true,
        versionNumber: true,
        published: true,
        createdAt: true,
        whodunnit: true,
        description: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        prompt_id: prompt.id,
        prompt_name: prompt.name,
        versions: versions.map((v) => ({
          id: v.id,
          version_number: v.versionNumber,
          published: v.published,
          created_at: v.createdAt.toISOString(),
          whodunnit: v.whodunnit,
          description: v.description,
        })),
        current_version_id: prompt.publishedVersionId,
        version_count: versions.length,
      },
    });
  } catch (error) {
    console.error("Error fetching prompt versions:", error);
    return NextResponse.json({ error: "Failed to fetch prompt versions" }, { status: 500 });
  }
}
