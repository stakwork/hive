import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { isDevelopmentMode } from "@/lib/runtime";
import { validateApiToken, API_TOKEN_ACTOR } from "@/lib/auth/api-token";


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

    // ── Lean state-only branch (`?fields=state`) ─────────────────────────────
    // Returns a minimal projection used by PublishPromptSlot to check live
    // publish state without fetching run-count aggregates or contributor emails.
    // Placement: after the membership gate and prompt/version fetch, but before
    // the two promptDailyRun queries and the batched user.findMany below.
    const fieldsParam = request.nextUrl.searchParams.get("fields");
    if (fieldsParam === "state") {
      return NextResponse.json({
        success: true,
        data: {
          prompt_id: id,
          versions: versions.map((v) => ({
            id: v.id,
            version_number: v.versionNumber,
            published: v.published,
            created_at: v.createdAt.toISOString(),
            source: v.source,
          })),
          current_version_id: versions[0]?.id ?? prompt.publishedVersionId,
          published_version_id: prompt.publishedVersionId,
        },
      });
    }

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

    // ── Display name resolution ───────────────────────────────────────────────
    // Collect unique user ids from whodunnit + publishedBy, excluding the api-token sentinel
    // and nulls.  Batch-fetch User+GitHubAuth in one query, then build a displayName map.
    const userIds = [
      ...new Set(
        versions.flatMap((v) => [v.whodunnit, v.publishedBy]).filter(
          (id): id is string => !!id && id !== API_TOKEN_ACTOR,
        ),
      ),
    ];

    const users =
      userIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true, githubAuth: { select: { githubUsername: true } } },
          })
        : [];

    const displayNameById = new Map<string, string>();
    // Hardcode the api-token sentinel display name
    displayNameById.set(API_TOKEN_ACTOR, "API Token");
    for (const u of users) {
      // Prefer GitHub username, fall back to email, then raw id
      const display = u.githubAuth?.githubUsername ?? u.email ?? u.id;
      displayNameById.set(u.id, display);
    }

    const versionsWithRunCount = versions.map((v) => ({
      id: v.id,
      version_number: v.versionNumber,
      value: v.value,
      description: v.description ?? "",
      whodunnit: v.whodunnit,
      whodunnit_display:
        displayNameById.get(v.whodunnit ?? "") ?? v.whodunnit ?? null,
      published: v.published,
      published_by: v.publishedBy,
      published_by_display:
        displayNameById.get(v.publishedBy ?? "") ?? v.publishedBy ?? null,
      published_at: v.publishedAt?.toISOString() ?? null,
      source: v.source,
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
