import { NextRequest, NextResponse } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";
import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";
import type {
  AuthContext,
  AuthenticatedUser,
  WorkspaceContext,
  WorkspaceAccess,
  AuthHandler,
  WorkspaceHandler,
  WithWorkspaceOptions,
  ApiSuccessResponse,
} from "./types";
import { ApiError, inferApiError, errorResponse } from "./errors";

/**
 * Extract middleware context from request headers
 * Retrieves user information set by middleware authentication
 * 
 * @param request - NextRequest with middleware headers
 * @returns Request ID and authenticated user (if present)
 */
function extractMiddlewareContext(request: NextRequest): {
  requestId: string;
  user: AuthenticatedUser | null;
} {
  const headers = request.headers;
  const requestId = headers.get(MIDDLEWARE_HEADERS.REQUEST_ID) || "";
  const authStatus = headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS);

  if (authStatus !== "authenticated") {
    return { requestId, user: null };
  }

  const userId = headers.get(MIDDLEWARE_HEADERS.USER_ID);
  const userEmail = headers.get(MIDDLEWARE_HEADERS.USER_EMAIL);
  const userName = headers.get(MIDDLEWARE_HEADERS.USER_NAME);

  if (!userId || !userEmail || !userName) {
    return { requestId, user: null };
  }

  return {
    requestId,
    user: {
      id: userId,
      email: userEmail,
      name: userName,
    },
  };
}

/**
 * Validate workspace access for a user
 * Checks workspace existence, soft-delete status, and user membership
 * 
 * @param slug - Workspace slug from route parameters
 * @param userId - User ID to check access for
 * @returns WorkspaceAccess object or null if not found/no access
 */
async function validateWorkspaceAccess(
  slug: string,
  userId: string
): Promise<WorkspaceAccess | null> {
  const workspace = await db.workspace.findFirst({
    where: {
      slug,
      deleted: false, // Soft-delete safety
    },
    include: {
      members: {
        where: {
          userId,
          leftAt: null, // User hasn't left the workspace
        },
      },
    },
  });

  if (!workspace) {
    return null;
  }

  const membership = workspace.members[0] || null;

  return {
    workspace: {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      ownerId: workspace.ownerId,
    },
    membership: membership
      ? {
          role: membership.role,
          userId: membership.userId,
        }
      : null,
    isOwner: workspace.ownerId === userId,
  };
}

/**
 * Check if user has required role in workspace
 * Uses role hierarchy: OWNER > ADMIN > PM > DEVELOPER > STAKEHOLDER > VIEWER
 * 
 * @param access - Workspace access object
 * @param requiredRole - Minimum role required
 * @param allowOwner - Allow workspace owner regardless of membership role
 * @returns True if user has sufficient permissions
 */
function hasRequiredRole(
  access: WorkspaceAccess,
  requiredRole?: WorkspaceRole,
  allowOwner = true
): boolean {
  // Workspace owner has full access (unless explicitly disabled)
  if (allowOwner && access.isOwner) {
    return true;
  }

  // No specific role required - any member can access
  if (!requiredRole) {
    return access.membership !== null || access.isOwner;
  }

  // User must be a member (or owner) to access
  if (!access.membership && !access.isOwner) {
    return false;
  }

  // Role hierarchy mapping
  const roleHierarchy: Record<WorkspaceRole, number> = {
    OWNER: 6,
    ADMIN: 5,
    PM: 4,
    DEVELOPER: 3,
    STAKEHOLDER: 2,
    VIEWER: 1,
  };

  // Get user's effective role (owner or membership role)
  const userRole = access.isOwner ? "OWNER" : access.membership!.role;
  const userRoleLevel = roleHierarchy[userRole];
  const requiredRoleLevel = roleHierarchy[requiredRole];

  return userRoleLevel >= requiredRoleLevel;
}

/**
 * Wrapper for authenticated routes
 * Extracts user from middleware context and validates authentication
 * Provides strongly-typed AuthContext with validated user information
 * 
 * @example
 * ```typescript
 * // Simple authenticated GET endpoint
 * export const GET = withAuth(async (request, context) => {
 *   const { user, requestId } = context;
 *   return successResponse({ userId: user.id, email: user.email });
 * });
 * ```
 * 
 * @example
 * ```typescript
 * // POST endpoint with request body
 * export const POST = withAuth(async (request, context) => {
 *   const { user } = context;
 *   const body = await request.json();
 *   
 *   const result = await someService(user.id, body);
 *   return successResponse(result, 201);
 * });
 * ```
 */
export function withAuth<TResponse = unknown>(
  handler: AuthHandler<TResponse>
): (
  request: NextRequest,
  routeContext?: { params: Promise<Record<string, string>> }
) => Promise<NextResponse> {
  return async (
    request: NextRequest,
    routeContext?: { params: Promise<Record<string, string>> }
  ) => {
    try {
      const { requestId, user } = extractMiddlewareContext(request);

      if (!user) {
        throw ApiError.unauthorized("Authentication required");
      }

      const context: AuthContext = {
        requestId,
        user,
      };

      return await handler(request, context);
    } catch (error) {
      const apiError = inferApiError(error);
      return errorResponse(apiError);
    }
  };
}

/**
 * Wrapper for workspace-scoped routes
 * Validates user authentication and workspace access
 * Supports role-based authorization via WorkspaceRole hierarchy
 * 
 * @example
 * ```typescript
 * // Basic workspace access (any member)
 * export const GET = withWorkspace(async (request, context) => {
 *   const { user, workspace } = context;
 *   return successResponse({
 *     workspaceId: workspace.workspace.id,
 *     workspaceName: workspace.workspace.name,
 *     userRole: workspace.membership?.role,
 *     isOwner: workspace.isOwner
 *   });
 * });
 * ```
 * 
 * @example
 * ```typescript
 * // Require ADMIN role or higher
 * export const DELETE = withWorkspace(
 *   async (request, context) => {
 *     const { workspace } = context;
 *     // Only OWNER or ADMIN can access
 *     await deleteWorkspaceResource(workspace.workspace.id);
 *     return successResponse({ deleted: true });
 *   },
 *   { requiredRole: "ADMIN" }
 * );
 * ```
 * 
 * @example
 * ```typescript
 * // Require PM role, but don't auto-allow owner
 * export const POST = withWorkspace(
 *   async (request, context) => {
 *     // Must be PM or higher (owner must also be a PM member)
 *     const body = await request.json();
 *     return successResponse(body);
 *   },
 *   { requiredRole: "PM", allowOwner: false }
 * );
 * ```
 */
export function withWorkspace<TResponse = unknown>(
  handler: WorkspaceHandler<TResponse>,
  options: WithWorkspaceOptions = {}
): (
  request: NextRequest,
  routeContext: { params: Promise<{ slug: string }> }
) => Promise<NextResponse> {
  return async (
    request: NextRequest,
    routeContext: { params: Promise<{ slug: string }> }
  ) => {
    try {
      const { requestId, user } = extractMiddlewareContext(request);

      if (!user) {
        throw ApiError.unauthorized("Authentication required");
      }

      const { slug } = await routeContext.params;

      if (!slug) {
        throw ApiError.badRequest("Workspace slug is required");
      }

      const access = await validateWorkspaceAccess(slug, user.id);

      if (!access) {
        throw ApiError.notFound("Workspace not found or access denied");
      }

      // Check role-based authorization
      if (!hasRequiredRole(access, options.requiredRole, options.allowOwner)) {
        const requiredRoleName = options.requiredRole || "member";
        throw ApiError.forbidden(
          `Insufficient permissions. Required role: ${requiredRoleName}`
        );
      }

      const context: WorkspaceContext = {
        requestId,
        user,
        workspace: access,
      };

      return await handler(request, context);
    } catch (error) {
      const apiError = inferApiError(error);
      return errorResponse(apiError);
    }
  };
}

/**
 * Helper to create standardized success responses
 * 
 * @example
 * ```typescript
 * return successResponse({ id: "123", name: "Task" }); // 200 OK
 * return successResponse({ id: "456" }, 201); // 201 Created
 * ```
 */
export function successResponse<T>(
  data: T,
  status = 200
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    { status }
  );
}