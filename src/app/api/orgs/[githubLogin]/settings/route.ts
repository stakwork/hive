import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { isJamieEngine, parseJamieEngine } from "@/lib/ai/jamieEngine";

/**
 * GET /api/orgs/[githubLogin]/settings — the org's settings for the
 * settings UI: `{ defaultWorkspaceId, jamieEngine }`. Admin-gated like
 * PATCH (the settings page is the admins').
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const context = getMiddlewareContext(_request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const orgId = await resolveAuthorizedOrgId(githubLogin, userOrResponse.id, true);
  if (!orgId) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }
  const org = await db.sourceControlOrg.findUnique({
    where: { id: orgId },
    select: { defaultWorkspaceId: true, jamieEngine: true },
  });
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  return NextResponse.json({
    defaultWorkspaceId: org.defaultWorkspaceId,
    jamieEngine: parseJamieEngine(org.jamieEngine),
  });
}

/**
 * PATCH /api/orgs/[githubLogin]/settings — one or both of:
 *   `{ defaultWorkspaceId: string | null }` — the org's default workspace;
 *   `{ jamieEngine: "hive" | "strut" }`     — which engine answers the org
 *                                              canvas chat (`lib/ai/jamieEngine.ts`).
 * A body with neither key is a 400, as before.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  // Admin gate: OWNER or ADMIN membership required
  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
  if (!orgId) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Body parse — own try/catch → 400
  let defaultWorkspaceId: string | null | undefined;
  let jamieEngine: string | undefined;
  try {
    const body = await request.json();
    const hasEngine = body !== null && typeof body === "object" && "jamieEngine" in body;
    if (hasEngine) {
      if (!isJamieEngine(body.jamieEngine)) {
        return NextResponse.json({ error: 'jamieEngine must be "hive" or "strut"' }, { status: 400 });
      }
      jamieEngine = body.jamieEngine;
    }
    // The default workspace is in play unless the body is ONLY an engine
    // change: a body without the key clears it, as it always did.
    if (!hasEngine || "defaultWorkspaceId" in body) {
      if (body.defaultWorkspaceId !== null && typeof body.defaultWorkspaceId !== "string") {
        return NextResponse.json({ error: "defaultWorkspaceId must be a string or null" }, { status: 400 });
      }
      defaultWorkspaceId = body.defaultWorkspaceId ?? null;
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Validate workspace belongs to this org (only when setting, not clearing)
  if (typeof defaultWorkspaceId === "string") {
    const ws = await db.workspace.findFirst({
      where: { id: defaultWorkspaceId, deleted: false, sourceControlOrgId: orgId },
    });
    if (!ws) {
      return NextResponse.json({ error: "Workspace not found in this org" }, { status: 400 });
    }
  }

  // Write
  try {
    const org = await db.sourceControlOrg.update({
      where: { id: orgId },
      data: {
        ...(defaultWorkspaceId !== undefined ? { defaultWorkspaceId } : {}),
        ...(jamieEngine !== undefined ? { jamieEngine } : {}),
      },
      select: { defaultWorkspaceId: true, jamieEngine: true },
    });
    return NextResponse.json({
      defaultWorkspaceId: org.defaultWorkspaceId,
      jamieEngine: parseJamieEngine(org.jamieEngine),
    });
  } catch (error) {
    console.error("[PATCH /api/orgs/[githubLogin]/settings]", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
