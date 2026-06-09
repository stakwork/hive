import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import type { MiddlewareUser } from "@/types/middleware";

/**
 * Validates the x-api-token header against the API_TOKEN environment variable.
 */
export function validateApiToken(request: NextRequest): boolean {
  const apiToken = request.headers.get("x-api-token");
  return !!apiToken && apiToken === process.env.API_TOKEN;
}

/**
 * Validates the x-api-token header against the LLM_SYNC_API_TOKEN environment variable.
 */
export function validateLlmSyncApiToken(request: NextRequest): boolean {
  const token = request.headers.get("x-api-token");
  return !!token && token === process.env.LLM_SYNC_API_TOKEN;
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
