import { WorkspaceRole } from "@prisma/client";
import type { 
  AuthSession, 
  WorkspaceAuthContext, 
  AuthServiceConfig,
  UserWorkspace 
} from "@/types/auth";
import { SessionService } from "./session";
import { WorkspaceAuthService } from "./workspace-auth";
import { PermissionService } from "./permissions";
import { isAuthError } from "./errors";

/**
 * Centralized authentication and authorization service
 * Orchestrates session, workspace, and permission services
 */
export class AuthService {
  private static instance: AuthService;
  private config: AuthServiceConfig;
  private sessionService: SessionService;
  private workspaceAuthService: WorkspaceAuthService;
  private permissionService: PermissionService;

  private constructor(config?: Partial<AuthServiceConfig>) {
    this.config = {
      requireAuth: true,
      ...config,
    };
    this.sessionService = new SessionService();
    this.workspaceAuthService = new WorkspaceAuthService();
    this.permissionService = new PermissionService();
  }

  /**
   * Get singleton instance of AuthService
   */
  public static getInstance(config?: Partial<AuthServiceConfig>): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService(config);
    }
    return AuthService.instance;
  }

  // Session methods
  public async getSession(): Promise<AuthSession | null> {
    return this.sessionService.getSession();
  }

  public async requireAuth(): Promise<AuthSession> {
    return this.sessionService.requireAuth();
  }

  public async getUserId(): Promise<string | null> {
    return this.sessionService.getUserId();
  }

  public async isAuthenticated(): Promise<boolean> {
    return this.sessionService.isAuthenticated();
  }

  // Workspace auth methods
  public async getWorkspaceContext(
    workspaceIdOrSlug: string,
    userId: string,
    bySlug: boolean = true
  ): Promise<WorkspaceAuthContext | null> {
    return this.workspaceAuthService.getWorkspaceContext(workspaceIdOrSlug, userId, bySlug);
  }

  public async validateWorkspaceAccess(
    workspaceSlug: string,
    userId: string,
    minimumRole?: WorkspaceRole
  ): Promise<WorkspaceAuthContext> {
    return this.workspaceAuthService.validateWorkspaceAccess(workspaceSlug, userId, minimumRole);
  }

  public async validateWorkspaceAccessById(
    workspaceId: string,
    userId: string,
    minimumRole?: WorkspaceRole
  ): Promise<WorkspaceAuthContext> {
    return this.workspaceAuthService.validateWorkspaceAccessById(workspaceId, userId, minimumRole);
  }

  public async hasWorkspaceRole(
    workspaceSlug: string,
    userId: string,
    minimumRole: WorkspaceRole
  ): Promise<boolean> {
    return this.workspaceAuthService.hasWorkspaceRole(workspaceSlug, userId, minimumRole);
  }

  public async getUserWorkspaces(userId: string): Promise<UserWorkspace[]> {
    return this.workspaceAuthService.getUserWorkspaces(userId);
  }

  public async getDefaultWorkspace(userId: string) {
    return this.workspaceAuthService.getDefaultWorkspace(userId);
  }

  // Convenience methods
  public async requireWorkspaceAccess(
    workspaceSlug: string,
    userId: string,
    minimumRole: WorkspaceRole = WorkspaceRole.VIEWER
  ): Promise<WorkspaceAuthContext> {
    return this.validateWorkspaceAccess(workspaceSlug, userId, minimumRole);
  }

  public async requireWorkspaceAdmin(
    workspaceSlug: string,
    userId: string
  ): Promise<WorkspaceAuthContext> {
    return this.validateWorkspaceAccess(workspaceSlug, userId, WorkspaceRole.ADMIN);
  }

  public async requireWorkspaceOwner(
    workspaceSlug: string,
    userId: string
  ): Promise<WorkspaceAuthContext> {
    return this.validateWorkspaceAccess(workspaceSlug, userId, WorkspaceRole.OWNER);
  }

  // Permission methods
  public getRolePermissions(role: WorkspaceRole) {
    return this.permissionService.getRolePermissions(role);
  }

  public hasMinimumRole(userRole: WorkspaceRole, minimumRole: WorkspaceRole): boolean {
    return this.permissionService.hasMinimumRole(userRole, minimumRole);
  }

  // Static utility method
  public static isAuthError(error: unknown) {
    return isAuthError(error);
  }
}

// Export singleton instance for convenience
export const authService = AuthService.getInstance();