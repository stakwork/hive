/** The gate for every generic benchmark route: benchmark exists + visible, then membership. */

import { NextRequest, NextResponse } from "next/server";
import { WorkspaceRole } from "@/lib/auth/roles";
import { resolveWorkspaceAccess, type WorkspaceAccess } from "@/lib/auth/workspace-access";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { checkRateLimit } from "@/lib/rate-limit";
import { benchmarkVisibleIn, getBenchmark, type Benchmark } from "@/lib/benchmarks/registry";

export type BenchmarkMember = Extract<WorkspaceAccess, { kind: "member" }>;

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function authorizeBenchmark(
  request: NextRequest,
  slug: string,
  benchmarkSlug: string,
  opts: { launch?: boolean } = {},
): Promise<{ member: BenchmarkMember; benchmark: Benchmark } | NextResponse> {
  const benchmark = getBenchmark(benchmarkSlug);
  if (!benchmark || !benchmarkVisibleIn(benchmark, slug)) return notFound();
  const access = await resolveWorkspaceAccess(request, { slug });
  if (access.kind === "unauthenticated") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (access.kind !== "member") return notFound();
  if (
    opts.launch &&
    WORKSPACE_PERMISSION_LEVELS[access.role] < WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER]
  ) {
    return NextResponse.json({ error: "Developer access required" }, { status: 403 });
  }
  return { member: access, benchmark };
}

const RATE_LIMIT_BACKEND_TIMEOUT_MS = 2_000;

/**
 * `checkRateLimit` that fails OPEN when its backend (Redis) is down or slow:
 * an unreachable limiter must not turn into a 500 on the route.
 */
export async function checkRateLimitSafe(
  key: string,
  limit: number,
  windowSecs: number,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  try {
    return await Promise.race([
      checkRateLimit(key, limit, windowSecs),
      new Promise<{ allowed: boolean }>((resolve) => setTimeout(() => resolve({ allowed: true }), RATE_LIMIT_BACKEND_TIMEOUT_MS)),
    ]);
  } catch {
    return { allowed: true };
  }
}
