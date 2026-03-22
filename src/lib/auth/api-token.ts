import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { validateApiKey } from "@/lib/api-keys";
import type { MiddlewareUser } from "@/types/middleware";

/**
 * Validates the x-api-token header against the API_TOKEN environment variable.
 */
export function validateApiToken(request: NextRequest): boolean {
  const apiToken = request.headers.get("x-api-token");
  return !!apiToken && apiToken === process.env.API_TOKEN;
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

/**
 * Dual auth: tries session auth first, falls back to Bearer workspace API key (hive_...).
 * When using Bearer API key, resolves the key creator as the acting user.
 *
 * @param request - The incoming request
 * @returns The authenticated user or an error response
 */
export async function requireAuthOrBearerApiKey(
  request: NextRequest,
): Promise<MiddlewareUser | NextResponse> {
  // 1. Try session auth first
  const context = getMiddlewareContext(request);
  const sessionResult = requireAuth(context);
  if (!(sessionResult instanceof NextResponse)) return sessionResult;

  // 2. Extract Bearer token
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!bearerToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Validate workspace API key
  const result = await validateApiKey(bearerToken);
  if (!result) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 4. Resolve key creator as acting user
  const user = await db.user.findUnique({
    where: { id: result.apiKey.createdById },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return { id: user.id, email: user.email || "", name: user.name || "" };
}
