import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { LEGAL_SLUGS } from "@/lib/eval-capture-slugs";

type RouteParams = {
  params: Promise<{ slug: string; matterId: string }>;
};

const GITHUB_API =
  "https://api.github.com/repos/stakwork/harvey-labs/contents";
const githubHeaders: HeadersInit = {
  Accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
};

const MATTER_ID_RE = /^\d{4}-\d{5}$/;

interface GitHubEntry {
  name: string;
  type: string;
  path: string;
  size: number;
}

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/cnh/matters/[matterId]
 *
 * Returns the categories (subdirectories) and files for a single matter.
 * Gated to LEGAL_SLUGS workspaces. Validates matterId to prevent path injection.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, matterId } = await params;

    if (!LEGAL_SLUGS.includes(slug)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!MATTER_ID_RE.test(matterId)) {
      return NextResponse.json(
        { error: "Invalid matterId format" },
        { status: 400 },
      );
    }

    const swarmResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmResult.success) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Fetch immediate children of the matter folder
    const ghRes = await fetch(
      `${GITHUB_API}/tasks/firm-knowledge/dms/matters/${matterId}`,
      { headers: githubHeaders },
    );

    if (!ghRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch matter detail from GitHub" },
        { status: 502 },
      );
    }

    const entries: GitHubEntry[] = await ghRes.json();
    const categoryDirs = entries.filter((e) => e.type === "dir");

    // Fetch files for each category directory in parallel
    const categoryResults = await Promise.all(
      categoryDirs.map(async (dir) => {
        const catRes = await fetch(
          `${GITHUB_API}/${dir.path}`,
          { headers: githubHeaders },
        );
        if (!catRes.ok) return { name: dir.name, files: [] };
        const catEntries: GitHubEntry[] = await catRes.json();
        const files = catEntries
          .filter((e) => e.type === "file")
          .map((e) => ({ name: e.name, size: e.size, path: e.path }));
        return { name: dir.name, files };
      }),
    );

    return NextResponse.json({ matterId, categories: categoryResults });
  } catch (error) {
    console.error("[cnh/matters/[matterId] GET] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
