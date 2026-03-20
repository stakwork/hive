import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { getUserAppTokens } from "@/lib/githubApp";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { getPRCountForRepo, bucketByWindows, PR_WINDOWS, WINDOW_DURATIONS_MS } from "@/lib/github/pr-stats";
import type { PRWindowKey } from "@/lib/github/pr-stats";

interface WindowStat {
  hiveCount: number;
  githubTotal: number | null;
  percentage: number | null;
}

type WindowStats = Record<PRWindowKey, WindowStat>;

function buildWindowStats(hiveCounts: Record<PRWindowKey, number>, githubCounts: Record<PRWindowKey, number> | null): WindowStats {
  const result = {} as WindowStats;
  for (const window of PR_WINDOWS) {
    const hiveCount = hiveCounts[window] ?? 0;
    const githubTotal = githubCounts ? (githubCounts[window] ?? 0) : null;
    const percentage =
      githubTotal !== null && githubTotal > 0
        ? Math.round((hiveCount / githubTotal) * 100)
        : null;
    result[window] = { hiveCount, githubTotal, percentage };
  }
  return result;
}

function emptyHiveCounts(): Record<PRWindowKey, number> {
  return { "24h": 0, "48h": 0, "1w": 0, "2w": 0, "1mo": 0 };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { id: workspaceId } = await params;

  const workspace = await db.workspaces.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      ownerId: true,
      repositories: {
        select: { id: true, repositoryUrl: true },
      },
    },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const now = new Date();
  const oneMonthAgo = new Date(now.getTime() - WINDOW_DURATIONS_MS["1mo"]);

  // Single raw SQL query for unique merged PULL_REQUEST artifacts in the last 30 days
  // Deduplicate by PR URL to avoid counting multiple artifacts for the same PR
  type ArtifactRow = { repo: string; created_at: Date };
  const rawArtifacts = await db.$queryRaw<ArtifactRow[]>`
    SELECT DISTINCT ON (a.content->>'url') a.content->>'repo' as repo, a.created_at
    FROM artifacts a
    JOIN chat_messages m ON a.message_id = m.id
    JOIN tasks t ON m.task_id = t.id
    WHERE a.type = 'PULL_REQUEST'
      AND t.workspace_id = ${workspaceId}
      AND a.created_at >= ${oneMonthAgo}
      AND a.content->>'status' = 'DONE'
    ORDER BY a.content->>'url', a.created_at ASC
  `;

  // Bucket hive artifacts in memory per repo
  const hiveByRepo = new Map<string, { createdAt: Date }[]>();
  for (const row of rawArtifacts) {
    if (!row.repo) continue;
    const repoKey = row.repo.toLowerCase();
    if (!hiveByRepo.has(repoKey)) hiveByRepo.set(repoKey, []);
    hiveByRepo.get(repoKey)!.push({ createdAt: new Date(row.created_at) });
  }

  // For each configured repository, fetch GitHub PR counts in parallel
  const repoResults = await Promise.allSettled(
    workspace.repositories.map(async (repo) => {
      let parsed: { owner: string; repo: string };
      try {
        parsed = parseGithubOwnerRepo(repo.repositoryUrl);
      } catch {
        return { repoUrl: repo.repositoryUrl, repoName: null as unknown as string, githubCounts: null as null | Record<PRWindowKey, number> };
      }

      const repoFullName = `${parsed.owner}/${parsed.repo}`;
      const repoKey = repoFullName.toLowerCase();

      let githubCounts: Record<PRWindowKey, number> | null = null;
      try {
        const tokens = await getUserAppTokens(workspace.ownerId, parsed.owner);
        if (tokens?.accessToken) {
          const { items } = await getPRCountForRepo(repoFullName, tokens.accessToken, oneMonthAgo);
          githubCounts = bucketByWindows(items, now);
        }
      } catch {
        // GitHub call failed — githubCounts stays null; cells will show "—"
      }

      const hiveItems = hiveByRepo.get(repoKey) ?? [];
      const hiveCounts = bucketByWindows(hiveItems, now);

      return { repoUrl: repo.repositoryUrl, repoName: repoFullName, repoKey, hiveCounts, githubCounts };
    }),
  );

  // Build per-repo response, track totals
  const totalHive = emptyHiveCounts();
  const totalGithub: Record<PRWindowKey, number | null> = { "24h": 0, "48h": 0, "1w": 0, "2w": 0, "1mo": 0 };
  let anyGithubNull = false;

  const repos = repoResults.map((result) => {
    if (result.status === "rejected") {
      // Entire repo processing failed — return nulled-out entry
      return null;
    }

    const { repoUrl, repoName, hiveCounts, githubCounts } = result.value as {
      repoUrl: string;
      repoName: string;
      repoKey: string;
      hiveCounts: Record<PRWindowKey, number>;
      githubCounts: Record<PRWindowKey, number> | null;
    };

    if (!repoName) {
      return null;
    }

    // Accumulate totals
    for (const w of PR_WINDOWS) {
      totalHive[w] += hiveCounts[w] ?? 0;
      if (githubCounts === null) {
        anyGithubNull = true;
        totalGithub[w] = null;
      } else if (totalGithub[w] !== null) {
        (totalGithub[w] as number) += githubCounts[w] ?? 0;
      }
    }

    return {
      repoUrl,
      repoName,
      windows: buildWindowStats(hiveCounts, githubCounts),
    };
  }).filter(Boolean);

  // Build totals windows — if any repo had a null github count, totals for that window are null
  const totalsWindows = {} as WindowStats;
  for (const w of PR_WINDOWS) {
    const hiveCount = totalHive[w];
    const githubTotal = anyGithubNull ? null : (totalGithub[w] as number);
    const percentage =
      githubTotal !== null && githubTotal > 0
        ? Math.round((hiveCount / githubTotal) * 100)
        : null;
    totalsWindows[w] = { hiveCount, githubTotal, percentage };
  }

  return NextResponse.json({
    repos,
    totals: { windows: totalsWindows },
  });
}
