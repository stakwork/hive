import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { validateWorkspaceAccess, validateWorkspaceAccessById } from "@/services/workspace";
import { WorkspaceRole } from "@prisma/client";

/**
 * Auth middleware helpers to reduce boilerplate in API routes
 * Wraps existing auth logic with consistent error handling
 */

/**
 * Get authenticated session or throw 401 error
 */
export async function requireAuth() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new AuthError("Authentication required", 401);
  }
  
  const userId = (session.user as { id?: string })?.id;
  if (!userId) {
    throw new AuthError("Invalid user session", 401);
  }
  
  return { session, userId };
}

/**
 * Require workspace access with optional minimum role
 */
export async function requireWorkspaceAccess(
  slug: string, 
  userId: string,
  minimumRole?: WorkspaceRole
) {
  const validation = await validateWorkspaceAccess(slug, userId);
  
  if (!validation.hasAccess) {
    throw new AuthError("Workspace not found or access denied", 404);
  }
  
  // Check minimum role if specified
  if (minimumRole) {
    const hasRequiredRole = checkMinimumRole(validation.userRole as WorkspaceRole, minimumRole);
    if (!hasRequiredRole) {
      throw new AuthError(`${minimumRole} role or higher required`, 403);
    }
  }
  
  return validation;
}

/**
 * Require workspace access by ID with optional minimum role
 */
export async function requireWorkspaceAccessById(
  workspaceId: string, 
  userId: string,
  minimumRole?: WorkspaceRole
) {
  const validation = await validateWorkspaceAccessById(workspaceId, userId);
  
  if (!validation.hasAccess) {
    throw new AuthError("Workspace not found or access denied", 404);
  }
  
  // Check minimum role if specified
  if (minimumRole) {
    const hasRequiredRole = checkMinimumRole(validation.userRole as WorkspaceRole, minimumRole);
    if (!hasRequiredRole) {
      throw new AuthError(`${minimumRole} role or higher required`, 403);
    }
  }
  
  return validation;
}

/**
 * Require admin access to workspace
 */
export async function requireWorkspaceAdmin(slug: string, userId: string) {
  return requireWorkspaceAccess(slug, userId, WorkspaceRole.ADMIN);
}

/**
 * Require owner access to workspace
 */
export async function requireWorkspaceOwner(slug: string, userId: string) {
  return requireWorkspaceAccess(slug, userId, WorkspaceRole.OWNER);
}

/**
 * Helper to check minimum role requirement
 */
function checkMinimumRole(userRole: WorkspaceRole, minimumRole: WorkspaceRole): boolean {
  const ROLE_HIERARCHY = {
    [WorkspaceRole.VIEWER]: 1,
    [WorkspaceRole.STAKEHOLDER]: 2, 
    [WorkspaceRole.DEVELOPER]: 3,
    [WorkspaceRole.PM]: 4,
    [WorkspaceRole.ADMIN]: 5,
    [WorkspaceRole.OWNER]: 6,
  };
  
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minimumRole];
}

/**
 * Standard auth error class
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Convert AuthError to NextResponse
 */
export function handleAuthError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message }, 
      { status: error.statusCode }
    );
  }
  
  // Handle other errors
  console.error('Unexpected auth error:', error);
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 }
  );
}

/**
 * Wrapper for API route handlers with auth
 * Reduces boilerplate to a single line
 */
export function withAuth(
  handler: (params: { userId: string; session: any }) => Promise<NextResponse>
) {
  return async (request: NextRequest, context?: any) => {
    try {
      const { session, userId } = await requireAuth();
      return await handler({ userId, session });
    } catch (error) {
      return handleAuthError(error);
    }
  };
}

/**
 * Wrapper for API route handlers with workspace auth
 */
export function withWorkspaceAuth(
  handler: (params: { 
    userId: string; 
    session: any; 
    workspace: any;
    slug: string;
  }) => Promise<NextResponse>,
  minimumRole?: WorkspaceRole
) {
  return async (
    request: NextRequest, 
    { params }: { params: Promise<{ slug: string }> }
  ) => {
    try {
      const { session, userId } = await requireAuth();
      const { slug } = await params;
      const workspace = await requireWorkspaceAccess(slug, userId, minimumRole);
      
      return await handler({ userId, session, workspace, slug });
    } catch (error) {
      return handleAuthError(error);
    }
  };
}