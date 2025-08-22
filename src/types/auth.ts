import { WorkspaceRole } from "@prisma/client";

/**
 * Extended session type with user ID and GitHub info
 */
export interface AuthSession {
  user: {
    id: string;
    email: string;
    name: string;
    image?: string;
    github?: {
      username?: string;
      publicRepos?: number;
      followers?: number;
    };
  };
  expires: string;
}

/**
 * Workspace permissions based on user role
 */
export interface WorkspacePermissions {
  canRead: boolean;
  canWrite: boolean;
  canAdmin: boolean;
  canDelete: boolean;
  canManageMembers: boolean;
  canManageSettings: boolean;
  canManageIntegrations: boolean;
  canCreateTasks: boolean;
  canManageProducts: boolean;
  canManageRoadmap: boolean;
}

/**
 * Workspace context with user role and permissions
 */
export interface WorkspaceAuthContext {
  workspace: {
    id: string;
    name: string;
    slug: string;
    ownerId: string;
    owner?: {
      id: string;
      name: string | null;
      email: string | null;
    };
  };
  userRole: WorkspaceRole;
  permissions: WorkspacePermissions;
}

/**
 * Auth error codes for standardized error handling
 */
export type AuthErrorCode =
  | "UNAUTHENTICATED"
  | "INSUFFICIENT_PERMISSIONS"
  | "WORKSPACE_NOT_FOUND"
  | "INVALID_TOKEN"
  | "SESSION_EXPIRED";

/**
 * Auth error with code and status
 */
export interface AuthError extends Error {
  code: AuthErrorCode;
  statusCode: number;
}

/**
 * Configuration for AuthService
 */
export interface AuthServiceConfig {
  requireAuth: boolean;
}

/**
 * User workspace with role and member count
 */
export interface UserWorkspace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  userRole: WorkspaceRole;
  memberCount: number;
}