import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import type { MiddlewareUser } from "@/types/middleware";
import { timingSafeEqual } from "crypto";

/**
 * Shared actor label for writes performed via x-api-token (no user session).
 * Used as `whodunnit` on PromptVersion rows created by token-authenticated callers.
 */
export const API_TOKEN_ACTOR = "api-token";

/**
 * Validates the x-api-token header against the API_TOKEN environment variable
 * using a constant-time comparison to prevent timing side-channel attacks.
 */
export function validateApiToken(request: NextRequest): boolean {
  const apiToken = request.headers.get("x-api-token");
  const envToken = process.env.API_TOKEN;
  if (!apiToken || !envToken) return false;
  // timingSafeEqual requires equal-length buffers — short-circuit on mismatch.
  const a = Buffer.from(apiToken);
  const b = Buffer.from(envToken);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Dual auth: tries session auth first, falls back to API_TOKEN.
 * When using API_TOKEN, looks up workspace owner as acting user.
 *
 * @param request - The incoming request
 * @param workspaceId - Required when using API_TOKEN auth (to resolve owner)
 * @returns The authenticated user or an error response
 */
export async function requireAuthOrApiToken(
  request: NextRequest,
  workspaceId?: string | null,
): Promise<MiddlewareUser | NextResponse> {
  // Try session-based auth first
  const context = getMiddlewareContext(request);
  const sessionResult = requireAuth(context);
  if (!(sessionResult instanceof NextResponse)) {
    return sessionResult;
  }

  // Fall back to API_TOKEN
  if (!validateApiToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required for API token auth" },
      { status: 400 },
    );
  }

  // Look up workspace owner as acting user
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      owner: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  if (!workspace?.owner) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  return {
    id: workspace.owner.id,
    email: workspace.owner.email || "",
    name: workspace.owner.name || "",
  };
}
