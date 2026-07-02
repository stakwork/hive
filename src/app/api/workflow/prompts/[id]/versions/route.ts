import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Prompt ID is required" }, { status: 400 });
    }

    const prompt = await db.prompt.findUnique({ where: { id } });
    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const versions = await db.promptVersion.findMany({
      where: { promptId: id },
      orderBy: { versionNumber: "desc" },
    });

    return NextResponse.json({
      success: true,
      data: {
        prompt_id: id,
        prompt_name: prompt.name,
        versions: versions.map((v) => ({
          id: v.id,
          version_number: v.versionNumber,
          value: v.value,
          description: v.description ?? "",
          whodunnit: v.whodunnit,
          published: v.published,
          created_at: v.createdAt.toISOString(),
        })),
        // current_version_id = latest version (highest versionNumber); may differ from published_version_id when a draft exists.
        current_version_id: versions[0]?.id ?? prompt.publishedVersionId,
        published_version_id: prompt.publishedVersionId,
        version_count: versions.length,
      },
    });
  } catch (error) {
    console.error("Error fetching prompt versions:", error);
    return NextResponse.json({ error: "Failed to fetch prompt versions" }, { status: 500 });
  }
}
