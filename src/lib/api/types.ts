import { NextRequest, NextResponse } from "next/server";
import { WorkspaceRole } from "@prisma/client";

/**
 * User extracted from middleware authentication headers
 * Available after withAuth wrapper validates authentication
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Base context for all API handlers
 * Contains request tracing information
 */
export interface BaseContext {
  requestId: string;
}

/**
 * Context for authenticated handlers
 * Includes validated user information from middleware
 */
export interface AuthContext extends BaseContext {
  user: AuthenticatedUser;
}

/**
 * Workspace access validation result
 * Contains workspace details, membership info, and ownership status
 */
export interface WorkspaceAccess {
  workspace: {
    id: string;
    slug: string;
    name: string;
    ownerId: string;
  };
  membership: {
    role: WorkspaceRole;
    userId: string;
  } | null;
  isOwner: boolean;
}

/**
 * Context for workspace-scoped handlers
 * Includes workspace access details and role information
 */
export interface WorkspaceContext extends AuthContext {
  workspace: WorkspaceAccess;
}

/**
 * Generic handler function signature
 * @template TContext - Context type (BaseContext, AuthContext, WorkspaceContext)
 * @template TResponse - Response data type
 */
export type Handler<TContext = BaseContext, TResponse = unknown> = (
  request: NextRequest,
  context: TContext
) => Promise<NextResponse<TResponse>>;

/**
 * Authenticated handler signature
 * Receives AuthContext with validated user
 */
export type AuthHandler<TResponse = unknown> = Handler<AuthContext, TResponse>;

/**
 * Workspace-scoped handler signature
 * Receives WorkspaceContext with validated workspace access
 */
export type WorkspaceHandler<TResponse = unknown> = Handler<WorkspaceContext, TResponse>;

/**
 * Options for withWorkspace wrapper
 */
export interface WithWorkspaceOptions {
  /**
   * Minimum role required to access this route
   * Uses role hierarchy: OWNER > ADMIN > PM > DEVELOPER > STAKEHOLDER > VIEWER
   */
  requiredRole?: WorkspaceRole;
  
  /**
   * Allow workspace owner regardless of membership role
   * @default true
   */
  allowOwner?: boolean;
}

/**
 * Standardized API success response
 */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
}

/**
 * Standardized API error response
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Union type for all API responses
 */
export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;