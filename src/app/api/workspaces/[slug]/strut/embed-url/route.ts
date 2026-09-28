import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/utils";
import { mintStrutEmbedUrl, strutTargetErrorResponse } from "@/services/strut-embed";
import { resolveStrutTarget } from "@/services/strut-target";
import { validateWorkspaceAccess } from "@/services/workspace";

export const runtime = "nodejs";

const LOG_TAG = "STRUT_EMBED";

/** The 1h TTL bounds how long a demoted admin keeps shell access: every
 * silent re-mint (`StrutView`'s visibility-based refresh) re-checks the role. */
const TOKEN_TTL_SECONDS = 60 * 60;

/**
 * POST /api/workspaces/[slug]/strut/embed-url
 *
 * Builds the iframe URL for THIS workspace's own swarm strut lab (never
 * the org default) — the workspace-scoped counterpart to the org embed
 * route. See `strut-embed.ts` for the mint + delegation + Hive-key steps.
 *
 * Access: Owner or Admin of this specific workspace, membership-only (no
 * public-viewer, no super-admin bypass). Both the role check and the
 * swarm resolution key off the same `Workspace.id` to close the IDOR gap.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;

  const { slug } = await params;

  const rl = await checkRateLimit(`strut-embed:${userId}:${slug}`, 10, 60);
  if (!rl.allowed) {
    logger.warn("Strut embed rate limit exceeded", LOG_TAG, { userId, slug });
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
    );
  }

  const access = await validateWorkspaceAccess(slug, userId);
  if (!access.hasAccess) {
    return NextResponse.json(
      { error: "Workspace not found or access denied" },
      { status: 404 },
    );
  }
  if (!access.canAdmin) {
    return NextResponse.json(
      { error: "Owner or Admin access required to open Strut" },
      { status: 403 },
    );
  }
  const workspace = access.workspace!;

  // Owners only get a `WorkspaceMember` row lazily, through `/access`,
  // which `WorkspaceContext` fires without waiting — it can race this
  // mint. Upsert it now so `ensureStrutDelegation` never throws on a
  // missing membership for the owner.
  if (workspace.ownerId === userId) {
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
      update: {},
      create: { workspaceId: workspace.id, userId, role: "OWNER" },
    });
  }

  const resolved = await resolveStrutTarget({
    purpose: "workspace_embed",
    workspaceId: workspace.id,
    userId,
  });
  if (!resolved.ok) {
    const { status, error } = strutTargetErrorResponse(resolved.error);
    return NextResponse.json({ error }, { status });
  }
  const { target } = resolved;
  if (target.workspaceId !== workspace.id) {
    logger.error("Strut target resolved to a different workspace than access was checked against", LOG_TAG, {
      slug,
      expectedWorkspaceId: workspace.id,
      resolvedWorkspaceId: target.workspaceId,
    });
    return NextResponse.json({ error: "Internal error resolving strut target" }, { status: 500 });
  }

  const minted = await mintStrutEmbedUrl(target, {
    userId,
    host: getBaseUrl(request.headers.get("host")),
    ttlSeconds: TOKEN_TTL_SECONDS,
  });
  if (!minted.ok) {
    return NextResponse.json({ error: minted.error }, { status: minted.status });
  }

  return NextResponse.json(
    { url: minted.url, workspaceSlug: target.workspaceSlug, expiresInSeconds: minted.expiresInSeconds },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
