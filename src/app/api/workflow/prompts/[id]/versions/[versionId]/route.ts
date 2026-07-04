import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { isDevelopmentMode } from "@/lib/runtime";


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

    const version = await db.promptVersion.findFirst({ where: { id: versionId, promptId: id } });
    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Enrich with run_count from local mirror table (single aggregate, no Stakwork call).
    const runCountResult = await db.promptDailyRun.aggregate({
      _sum: { runCount: true },
      where: { promptId: id, versionId },
    });

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
        run_count: runCountResult._sum.runCount ?? 0,
      },
    });
  } catch (error) {
    console.error("Error fetching prompt version:", error);
    return NextResponse.json({ error: "Failed to fetch prompt version" }, { status: 500 });
  }
}
