/**
 * Auth Service - Main export file
 * Re-exports all auth service components for easy importing
 */

export { AuthService, authService } from "./auth-service";
export { WorkspaceAuthService } from "./workspace-auth";
export { SessionService } from "./session";
export { PermissionService } from "./permissions";
export * from "./errors";
export type * from "@/types/auth";