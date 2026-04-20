import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMiddlewareContext } from "@/lib/middleware/utils";
import { WorkspaceRole } from "@/lib/auth/roles";

/**
 * Result of resolving a request's access to a workspace.
 *
 * - `member`: authenticated user with a workspace membership.
 * - `public-viewer`: unauthenticated visitor on a workspace flagged as
 *   `isPublicViewable`. Has no userId — read-only access implied.
 */
export type WorkspaceAccess =
  | {
      kind: "member";
      userId: string;
      workspaceId: string;
      slug: string;
      role: WorkspaceRole;
    }
  | {
      kind: "public-viewer";
      userId: null;
      workspaceId: string;
      slug: string;
      role: typeof WorkspaceRole.VIEWER;
    };

export type WorkspaceLookup = { slug: string } | { workspaceId: string };

/**
 * Resolves a request's access to a workspace.
 *
 * Flow:
 *   1. If the request has an authenticated middleware user, verify workspace
 *      membership and return `{ kind: "member", ... }`. The user's role is
 *      read from `WorkspaceMember`. Workspace owners get `OWNER` implicitly.
 *   2. Otherwise, if the workspace has `isPublicViewable: true`, return
 *      `{ kind: "public-viewer", role: VIEWER }`.
 *   3. Otherwise, return `null` (caller should respond 404).
 *
 * This helper is the single entry point for any API route that wants to
 * support both authenticated members and unauthenticated public viewers.
 */
export async function resolveWorkspaceAccess(
  request: NextRequest,
  lookup: WorkspaceLookup,
): Promise<WorkspaceAccess | null> {
  const workspace = await db.workspace.findFirst({
    where: {
      ...("slug" in lookup
        ? { slug: lookup.slug }
        : { id: lookup.workspaceId }),
      deleted: false,
    },
    select: {
      id: true,
      slug: true,
      ownerId: true,
      isPublicViewable: true,
    },
  });

  if (!workspace) return null;

  const context = getMiddlewareContext(request);

  if (context.authStatus === "authenticated" && context.user) {
    const userId = context.user.id;

    // Owner: full access without needing a membership row.
    if (workspace.ownerId === userId) {
      return {
        kind: "member",
        userId,
        workspaceId: workspace.id,
        slug: workspace.slug,
        role: WorkspaceRole.OWNER,
      };
    }

    const membership = await db.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId,
        },
      },
      select: { role: true },
    });

    if (membership) {
      return {
        kind: "member",
        userId,
        workspaceId: workspace.id,
        slug: workspace.slug,
        role: membership.role as WorkspaceRole,
      };
    }

    // Authenticated but not a member — fall through to public-viewer check.
  }

  if (workspace.isPublicViewable) {
    return {
      kind: "public-viewer",
      userId: null,
      workspaceId: workspace.id,
      slug: workspace.slug,
      role: WorkspaceRole.VIEWER,
    };
  }

  return null;
}

/**
 * Convenience guard for read-only (GET) handlers. Returns the access object
 * if the caller may read, or a 404 NextResponse otherwise.
 *
 * Both authenticated members and public viewers are allowed.
 */
export function requireReadAccess(
  access: WorkspaceAccess | null,
): WorkspaceAccess | NextResponse {
  if (!access) {
    return NextResponse.json(
      { error: "Workspace not found or access denied" },
      { status: 404 },
    );
  }
  return access;
}

/**
 * Convenience guard for mutating handlers. Returns the access object if the
 * caller is a member (any role), or the appropriate error response otherwise.
 *
 * Public viewers are rejected with 401 so the UI can prompt sign-in. Missing
 * workspaces return 404.
 *
 * Role-based authorization (e.g. VIEWER cannot write) is left to the caller
 * — this helper just enforces "must be a real member, not a public viewer".
 */
export function requireMemberAccess(
  access: WorkspaceAccess | null,
): Extract<WorkspaceAccess, { kind: "member" }> | NextResponse {
  if (!access) {
    return NextResponse.json(
      { error: "Workspace not found or access denied" },
      { status: 404 },
    );
  }
  if (access.kind === "public-viewer") {
    return NextResponse.json(
      { error: "Sign in required" },
      { status: 401 },
    );
  }
  return access;
}

export function isPublicViewer(
  access: WorkspaceAccess,
): access is Extract<WorkspaceAccess, { kind: "public-viewer" }> {
  return access.kind === "public-viewer";
}
