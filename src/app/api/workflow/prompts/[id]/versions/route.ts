import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { isDevelopmentMode } from "@/lib/runtime";
import { validateApiToken } from "@/lib/auth/api-token";


export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const isApiToken = validateApiToken(request);
    if (!isApiToken) {
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

    // Enrich versions with run_count from local mirror table — one grouped query, no N+1.
    const [dailyRunGroups, totalRunCountResult] = await Promise.all([
      db.promptDailyRun.groupBy({
        by: ["versionId"],
        _sum: { runCount: true },
        where: { promptId: id },
      }),
      db.promptDailyRun.aggregate({
        _sum: { runCount: true },
        where: { promptId: id },
      }),
    ]);

    const runCountByVersionId = new Map<string, number>();
    for (const group of dailyRunGroups) {
      if (group.versionId) {
        runCountByVersionId.set(group.versionId, group._sum.runCount ?? 0);
      }
    }

    const versionsWithRunCount = versions.map((v) => ({
      id: v.id,
      version_number: v.versionNumber,
      value: v.value,
      description: v.description ?? "",
      whodunnit: v.whodunnit,
      published: v.published,
      created_at: v.createdAt.toISOString(),
      run_count: runCountByVersionId.get(v.id) ?? 0,
    }));

    return NextResponse.json({
      success: true,
      data: {
        prompt_id: id,
        prompt_name: prompt.name,
        versions: versionsWithRunCount,
        // current_version_id = latest version (highest versionNumber); may differ from published_version_id when a draft exists.
        current_version_id: versions[0]?.id ?? prompt.publishedVersionId,
        published_version_id: prompt.publishedVersionId,
        version_count: versions.length,
        total_run_count: totalRunCountResult._sum.runCount ?? 0,
      },
    });
  } catch (error) {
    console.error("Error fetching prompt versions:", error);
    return NextResponse.json({ error: "Failed to fetch prompt versions" }, { status: 500 });
  }
}
