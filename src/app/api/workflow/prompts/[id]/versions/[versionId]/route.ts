import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { isDevelopmentMode } from "@/lib/runtime";
import { fetchVersionRunCount } from "@/services/prompts/prompt-sync";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET(
  _request: NextRequest,
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

    const { id, versionId } = await params;
    if (!id) {
      return NextResponse.json({ error: "Prompt ID is required" }, { status: 400 });
    }
    if (!versionId) {
      return NextResponse.json({ error: "Version ID is required" }, { status: 400 });
    }

    const [version, prompt] = await Promise.all([
      db.promptVersion.findFirst({ where: { id: versionId, promptId: id } }),
      db.prompt.findUnique({ where: { id }, select: { name: true } }),
    ]);
    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Best-effort run_count enrichment — degrade to null on Stakwork failure.
    const runCount = prompt ? await fetchVersionRunCount(prompt.name, version.id) : null;

    return NextResponse.json({
      success: true,
      data: {
        id: version.id,
        prompt_id: version.promptId,
        version_number: version.versionNumber,
        value: version.value,
        description: version.description ?? "",
        whodunnit: version.whodunnit,
        published: version.published,
        created_at: version.createdAt.toISOString(),
        run_count: runCount,
      },
    });
  } catch (error) {
    console.error("Error fetching prompt version:", error);
    return NextResponse.json({ error: "Failed to fetch prompt version" }, { status: 500 });
  }
}
