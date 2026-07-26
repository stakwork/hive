import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

type RouteParams = {
  params: Promise<{ slug: string; taskSlug: string[] }>;
};

type DocumentEntry = { name: string; type: string; size: number };

const TASK_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

function handleSwarmAccessError(error: { type: string }) {
  const errorMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
    SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
  };
  const errorInfo = errorMap[error.type] ?? { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

/**
 * GET /api/workspaces/[slug]/legal/benchmarks/tasks/size/[...taskSlug]
 *
 * Returns total and per-file sizes (in bytes) for a Harvey LAB task's
 * documents folder via the GitHub Contents API.
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

    const ip = getClientIp(request);
    const rateLimitResult = await checkRateLimit(`task-size:get:${ip}`, 60, 60);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const taskSlug = taskSlugParts.join("/");

    if (!TASK_SLUG_REGEX.test(taskSlug)) {
      return NextResponse.json({ error: "Invalid task slug" }, { status: 400 });
    }

    const githubToken = process.env.GITHUB_TOKEN;
    const documentsApiUrl = `https://api.github.com/repos/stakwork/harvey-labs/contents/tasks/${taskSlug}/documents`;

    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (githubToken) {
      headers["Authorization"] = `Bearer ${githubToken}`;
    }

    const docsRes = await fetch(documentsApiUrl, { headers });

    if (!docsRes.ok) {
      logger.error("[legal/benchmarks/tasks/size GET] GitHub API error", "github-api", {
        status: docsRes.status,
        taskSlug,
      });
      return NextResponse.json({ error: "Failed to fetch document sizes" }, { status: 502 });
    }

    let entries: DocumentEntry[] = [];
    try {
      entries = await docsRes.json();
    } catch {
      return NextResponse.json({ error: "Failed to parse GitHub response" }, { status: 502 });
    }

    const files = Array.isArray(entries)
      ? entries
          .filter((e) => e.type === "file")
          .map((e) => ({ name: e.name, size: e.size }))
      : [];

    const total_source_size_bytes = files.reduce((sum, f) => sum + f.size, 0);

    return NextResponse.json({ total_source_size_bytes, files });
  } catch (error) {
    logger.error("[legal/benchmarks/tasks/size GET] Unexpected error:", "unexpected", { error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
