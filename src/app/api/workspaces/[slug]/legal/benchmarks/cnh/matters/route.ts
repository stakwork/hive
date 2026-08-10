import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { LEGAL_SLUGS } from "@/lib/eval-capture-slugs";

type RouteParams = {
  params: Promise<{ slug: string }>;
};

const GITHUB_API =
  "https://api.github.com/repos/stakwork/harvey-labs/contents";
const githubHeaders: HeadersInit = {
  Accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
};

interface GitHubEntry {
  name: string;
  type: string;
  path: string;
}

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/cnh/matters
 *
 * Lists all C&H Law Firm matter folders from GitHub, grouped by 4-digit
 * client prefix. Gated to LEGAL_SLUGS workspaces.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    if (!LEGAL_SLUGS.includes(slug)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const swarmResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmResult.success) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const ghRes = await fetch(
      `${GITHUB_API}/tasks/firm-knowledge/dms/matters`,
      { headers: githubHeaders },
    );

    if (!ghRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch matter list from GitHub" },
        { status: 502 },
      );
    }

    const entries: GitHubEntry[] = await ghRes.json();
    const dirs = entries.filter((e) => e.type === "dir");

    // Group by 4-digit client prefix
    const grouped = new Map<
      string,
      Array<{ matterId: string; path: string }>
    >();
    for (const dir of dirs) {
      const clientCode = dir.name.split("-")[0];
      if (!grouped.has(clientCode)) grouped.set(clientCode, []);
      grouped.get(clientCode)!.push({
        matterId: dir.name,
        path: dir.path,
      });
    }

    const groups = Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([clientCode, matters]) => ({ clientCode, matters }));

    return NextResponse.json({ groups, total: dirs.length });
  } catch (error) {
    console.error("[cnh/matters GET] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
