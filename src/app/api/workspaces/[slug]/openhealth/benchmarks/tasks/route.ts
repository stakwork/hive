import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { OPENHEALTH_SLUGS } from "@/lib/eval-capture-slugs";
import {
  isOpenHealthSplit,
  isOpenHealthTaskName,
  OPENHEALTH_DEFAULT_SPLIT,
  projectOpenHealthInstanceSummary,
  type OpenHealthTaskName,
} from "@/lib/openhealth-benchmarks/constants";
import { fetchOpenHealthInstances } from "@/lib/openhealth-benchmarks/scorer-client";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/**
 * GET /api/workspaces/[slug]/openhealth/benchmarks/tasks
 *
 * Read-only public/heldout-split task metadata list, proxied from the
 * OpenHealth swarm's scorer (`GET /score/instances`). Never returns gold.
 * Gated to the `openhealth` workspace only.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug } = await params;

    // Slug gate FIRST — before any access check, so a non-openhealth slug
    // (or a non-member probing it) gets the same 404 either way.
    if (!OPENHEALTH_SLUGS.includes(slug)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // A viewer may read. A non-member gets 404, not 403.
    const access = await validateWorkspaceAccess(slug, userId, true, {});
    if (!access.canRead) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Fail closed, before any swarm credential use or upstream call.
    let rl: { allowed: boolean; retryAfter?: number };
    try {
      rl = await checkRateLimit(`openhealth-benchmark-tasks:${userId}`, 60, 60);
    } catch {
      return NextResponse.json(
        { error: "Rate limit service unavailable" },
        { status: 503 },
      );
    }
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: rl.retryAfter },
        { status: 429 },
      );
    }

    const url = new URL(request.url);
    const splitParam = url.searchParams.get("split");
    const taskParam = url.searchParams.get("task");
    const limitParam = url.searchParams.get("limit");
    const offsetParam = url.searchParams.get("offset");

    // Default is public when the param is omitted. Any other value —
    // including empty string, "train", or a typo — is rejected with 400.
    const split = splitParam === null ? OPENHEALTH_DEFAULT_SPLIT : splitParam;
    if (!isOpenHealthSplit(split)) {
      return NextResponse.json(
        { error: 'split must be "public" or "heldout"' },
        { status: 400 },
      );
    }

    let taskName: OpenHealthTaskName | undefined;
    if (taskParam !== null) {
      if (!isOpenHealthTaskName(taskParam)) {
        return NextResponse.json({ error: "Invalid task" }, { status: 400 });
      }
      taskName = taskParam;
    }

    let limit = DEFAULT_LIMIT;
    if (limitParam !== null) {
      const parsed = parseInt(limitParam, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
      }
      limit = Math.min(parsed, MAX_LIMIT);
    }

    let offset: number | undefined;
    if (offsetParam !== null) {
      const parsed = parseInt(offsetParam, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        return NextResponse.json({ error: "offset must be >= 0" }, { status: 400 });
      }
      offset = parsed;
    }

    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      return NextResponse.json({ error: "Swarm not configured" }, { status: 503 });
    }
    const { swarmUrl, swarmApiKey } = swarmResult.data;
    if (!swarmUrl || !swarmApiKey) {
      return NextResponse.json({ error: "Swarm not configured" }, { status: 503 });
    }

    let upstream;
    try {
      upstream = await fetchOpenHealthInstances(swarmUrl, swarmApiKey, {
        split,
        task: taskName as ReturnType<typeof isOpenHealthTaskName> extends boolean ? never : never as never,
        limit,
        offset,
      } as never);
    } catch (err) {
      logger.error("[openhealth/benchmarks/tasks] scorer fetch failed", "openhealth-benchmarks", {
        split,
        task: taskName,
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json({ error: "Failed to fetch task list" }, { status: 502 });
    }

    // Allowlist projection — applied even though the upstream shape is
    // expected to already exclude gold. A projection that omits gold
    // upstream is not a substitute for dropping it here too.
    const rows = upstream.rows.map((row) =>
      projectOpenHealthInstanceSummary(row as Record<string, unknown>),
    );

    return NextResponse.json({
      rows,
      split,
      task: taskName ?? null,
      limit,
      offset: offset ?? 0,
      total: upstream.total ?? null,
    });
  } catch (error) {
    logger.error("[openhealth/benchmarks/tasks GET] Unexpected error", "openhealth-benchmarks", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
