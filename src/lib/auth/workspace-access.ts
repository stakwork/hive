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
 * - `unauthenticated`: request has no session and the workspace is not public.
 * - `not-found`: workspace does not exist (authenticated request only).
 * - `forbidden`: authenticated user is not a member of a private workspace.
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
    }
  | { kind: "unauthenticated" }
  | { kind: "not-found" }
  | { kind: "forbidden" };

export type WorkspaceLookup = { slug: string } | { workspaceId: string };

export async function resolveWorkspaceAccess(
  request: NextRequest,
  lookup: WorkspaceLookup,
): Promise<WorkspaceAccess> {
  const context = getMiddlewareContext(request);
  const isAuthenticated = context.authStatus === "authenticated" && !!context.user;

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

  if (!workspace) {
    if (!isAuthenticated) return { kind: "unauthenticated" };
    return { kind: "not-found" };
  }

  if (isAuthenticated && context.user) {
    const userId = context.user.id;

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

  if (!isAuthenticated) return { kind: "unauthenticated" };
  return { kind: "forbidden" };
}

export function requireReadAccess(
  access: WorkspaceAccess,
): Extract<WorkspaceAccess, { kind: "member" | "public-viewer" }> | NextResponse {
  if (access.kind === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (access.kind === "not-found") {
    return NextResponse.json(
      { error: "Workspace not found or access denied" },
      { status: 404 },
    );
  }
  if (access.kind === "forbidden") {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return access;
}

export function requireMemberAccess(
  access: WorkspaceAccess,
): Extract<WorkspaceAccess, { kind: "member" }> | NextResponse {
  if (access.kind === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (access.kind === "not-found") {
    return NextResponse.json(
      { error: "Workspace not found or access denied" },
      { status: 404 },
    );
  }
  if (access.kind === "forbidden") {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (access.kind === "public-viewer") {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  return access;
}

export function isPublicViewer(
  access: WorkspaceAccess | null | undefined,
): access is Extract<WorkspaceAccess, { kind: "public-viewer" }> {
  return access?.kind === "public-viewer";
}
