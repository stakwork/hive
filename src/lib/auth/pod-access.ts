import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateApiToken } from "@/lib/auth/api-token";
import { isOrgApiKey, validateOrgApiKey } from "@/lib/org-api-keys";

/**
 * Who is calling a pod endpoint, after auth + workspace access checks.
 *
 * - `system`: global API_TOKEN (Stakwork etc.) — trusted for any workspace.
 * - `org`:    org API key (`hiveorg_…`, e.g. strut) — only workspaces in its org.
 * - `user`:   session / mobile bearer — owner or active member of the workspace.
 */
export type PodCaller =
  | { kind: "system"; workspaceId: string }
  | { kind: "org"; workspaceId: string; orgId: string; apiKeyId: string; actingUserId: string }
  | { kind: "user"; workspaceId: string; userId: string };

type WorkspaceRef = { id: string } | { slug: string };

const accessDenied = () => NextResponse.json({ error: "Access denied" }, { status: 403 });
const notFound = () => NextResponse.json({ error: "Workspace not found" }, { status: 404 });

/**
 * Authenticate a pod endpoint request and authorize it for one workspace.
 * Must run before any DB write, secret access, or pool-manager call.
 */
export async function resolvePodCaller(
  request: NextRequest,
  ref: WorkspaceRef,
): Promise<PodCaller | NextResponse> {
  const headerToken = request.headers.get("x-api-token");

  if (isOrgApiKey(headerToken)) {
    const validated = await validateOrgApiKey(headerToken);
    if (!validated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workspace = await db.workspace.findFirst({
      where: { ...ref, deleted: false },
      select: { id: true, sourceControlOrgId: true },
    });
    if (!workspace) return notFound();
    if (workspace.sourceControlOrgId !== validated.orgId) return accessDenied();
    return {
      kind: "org",
      workspaceId: workspace.id,
      orgId: validated.orgId,
      apiKeyId: validated.apiKey.id,
      actingUserId: validated.apiKey.createdById,
    };
  }

  if (validateApiToken(request)) {
    const workspace = await db.workspace.findFirst({ where: ref, select: { id: true } });
    if (!workspace) return notFound();
    return { kind: "system", workspaceId: workspace.id };
  }

  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;

  const workspace = await db.workspace.findFirst({
    where: { ...ref, deleted: false },
    select: {
      id: true,
      ownerId: true,
      members: { where: { userId, leftAt: null }, select: { role: true } },
    },
  });
  if (!workspace) return notFound();
  if (workspace.ownerId !== userId && workspace.members.length === 0) return accessDenied();

  return { kind: "user", workspaceId: workspace.id, userId };
}
