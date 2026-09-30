/**
 * GET /api/orgs/[githubLogin]/strut/workflows?q=<query>
 *
 * Authenticated, bounded suggestion proxy behind Jamie chat's structured
 * `@workflow` mentions (`SidebarChat.tsx`'s composer). Returns at most
 * `MAX_WORKFLOW_SUGGESTIONS` normalized `{ id, name }` records from the
 * caller's authorized org-default Strut — never the swarm URL, API key,
 * actor, raw upstream records, or upstream error bodies.
 *
 * Order, each gate before the next:
 *   1. `requireAuth` — session required.
 *   2. `resolveAuthorizedOrgId(githubLogin, userId, false)` — null => 404
 *      (unified with "org doesn't exist" so org existence isn't leaked).
 *   3. Validate `q` — required param, empty allowed, else <=100 chars.
 *   4. Per-user AND per-org rate limit — before any credentialed call.
 *   5. `resolveStrutTarget({ purpose: "chat", userId, orgGithubLogin })` and
 *      require `target.orgId === orgId` (defense in depth — the org-default
 *      policy already scopes to this org's swarm, but this is the same
 *      belt-and-suspenders check `strutTools.ts`'s `resolveStrut` applies).
 *   6. `searchStrutWorkflows` — server-side filtered upstream catalog read.
 *
 * Failures: auth/org → existing Hive shapes; bad `q` → 400; rate limit →
 * 429 + Retry-After; upstream timeout → 504; any other upstream/schema
 * failure → sanitized 502 (no upstream body reaches the client). Failures
 * are logged with status/org/user/failure-category/reference-count —
 * never workflow names, swarm credentials, API tokens, or URLs.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { strutTargetErrorResponse } from "@/services/strut-embed";
import { resolveStrutTarget } from "@/services/strut-target";
import {
  MAX_WORKFLOW_QUERY_LEN,
  StrutWorkflowCatalogError,
  searchStrutWorkflows,
} from "@/services/strut-workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_TAG = "STRUT_WORKFLOWS_PROXY";
const RATE_LIMIT_PER_USER = 30;
const RATE_LIMIT_PER_ORG = 120;
const RATE_WINDOW_SECS = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin } = await params;

  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const qParam = request.nextUrl.searchParams.get("q");
  if (qParam === null || qParam.length > MAX_WORKFLOW_QUERY_LEN) {
    return NextResponse.json({ error: "A valid q parameter is required" }, { status: 400 });
  }

  const [userLimit, orgLimit] = await Promise.all([
    checkRateLimit(`strut-workflows:user:${userId}`, RATE_LIMIT_PER_USER, RATE_WINDOW_SECS),
    checkRateLimit(`strut-workflows:org:${orgId}`, RATE_LIMIT_PER_ORG, RATE_WINDOW_SECS),
  ]);
  const limited = [userLimit, orgLimit].find((r) => !r.allowed);
  if (limited) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter ?? RATE_WINDOW_SECS) } },
    );
  }

  const resolved = await resolveStrutTarget({ purpose: "chat", userId, orgGithubLogin: githubLogin });
  if (!resolved.ok) {
    const mapped = strutTargetErrorResponse(resolved.error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  if (resolved.target.orgId !== orgId) {
    logger.warn("Strut workflow proxy: target org mismatch", LOG_TAG, { orgId, userId });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const workflows = await searchStrutWorkflows(resolved.target, qParam);
    return NextResponse.json({ workflows });
  } catch (err) {
    if (err instanceof StrutWorkflowCatalogError) {
      logger.warn("Strut workflow catalog read failed", LOG_TAG, {
        status: err.type,
        orgId,
        userId,
        failureCategory: err.type,
      });
      if (err.type === "timeout") {
        return NextResponse.json({ error: "Strut workflow catalog timed out" }, { status: 504 });
      }
      return NextResponse.json({ error: "Could not fetch workflows right now" }, { status: 502 });
    }
    logger.error("Strut workflow proxy unexpected error", LOG_TAG, {
      orgId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not fetch workflows right now" }, { status: 502 });
  }
}
