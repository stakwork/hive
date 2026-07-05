import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";

// GITHUB_TOKEN must be set in the deployment environment.
// Unauthenticated GitHub API calls still work but have lower rate limits.

type RouteParams = {
  params: Promise<{ slug: string; taskSlug: string[] }>;
};

interface GitHubFileEntry {
  type: string;
  name: string;
  html_url: string;
  download_url: string;
}

interface TaskJson {
  title?: string;
  instructions?: string;
  criteria?: Array<{ id: string; title: string; match_criteria: string }>;
}

function handleSwarmAccessError(error: { type: string }) {
  const errorMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
    SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
  };
  const errorInfo = errorMap[error.type] || { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/tasks/[...taskSlug]/details
 *
 * Fetches task instructions, criteria, and document listings from the
 * harvey-labs GitHub repo for the given task slug.
 * Gated to the `openlaw` workspace only.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, taskSlug: taskSlugParts } = await params;

    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const swarmResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    // Rejoin catch-all segments to reconstruct the full slug (e.g. "contracts/review-contract")
    const taskSlug = taskSlugParts.join("/");

    const githubToken = process.env.GITHUB_TOKEN;

    const taskJsonUrl = `https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/${taskSlug}/task.json`;
    const documentsApiUrl = `https://api.github.com/repos/stakwork/harvey-labs/contents/tasks/${taskSlug}/documents`;

    const docsHeaders: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (githubToken) {
      docsHeaders["Authorization"] = `Bearer ${githubToken}`;
    }

    // Fetch task JSON and document listing in parallel
    const [taskRes, docsRes] = await Promise.all([
      fetch(taskJsonUrl),
      fetch(documentsApiUrl, { headers: docsHeaders }),
    ]);

    if (!taskRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch task data from GitHub: ${taskRes.status} ${taskRes.statusText}` },
        { status: 502 },
      );
    }

    let taskData: TaskJson;
    try {
      taskData = await taskRes.json();
    } catch {
      return NextResponse.json(
        { error: "Failed to parse task JSON from GitHub" },
        { status: 502 },
      );
    }

    let documents: Array<{ name: string; url: string; download_url: string }> = [];
    if (docsRes.ok) {
      try {
        const entries: GitHubFileEntry[] = await docsRes.json();
        documents = Array.isArray(entries)
          ? entries
              .filter((e) => e.type === "file")
              .map((e) => ({ name: e.name, url: e.html_url, download_url: e.download_url }))
          : [];
      } catch {
        // Non-fatal: return empty documents list rather than failing
        documents = [];
      }
    }
    // If docsRes is 404 (no documents folder), documents stays empty — not a failure

    return NextResponse.json({
      title: taskData.title ?? null,
      instructions: taskData.instructions ?? null,
      criteria: taskData.criteria ?? null,
      documents,
    });
  } catch (error) {
    console.error("[legal/benchmarks/tasks/details GET] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
