import {
  CreateWorkspaceRequest,
  WorkspaceResponse,
  WorkspaceWithRole,
  WorkspaceWithAccess,
  WorkspaceAccessValidation,
  WorkspaceRole,
  SlugValidationResult,
} from "@/types/workspace";

// Import all modules
import * as crud from "./workspace-crud";
import * as access from "./workspace-access";
import * as validation from "./workspace-validation";

/**
 * Main WorkspaceService class that orchestrates all workspace operations
 * Provides a clean interface to all workspace functionality
 */
export class WorkspaceService {
  // CRUD Operations
  static async createWorkspace(data: CreateWorkspaceRequest): Promise<WorkspaceResponse> {
    return crud.createWorkspace(data);
  }

  static async getWorkspacesByUserId(userId: string): Promise<WorkspaceResponse[]> {
    return crud.getWorkspacesByUserId(userId);
  }

  static async getUserWorkspaces(userId: string): Promise<WorkspaceWithRole[]> {
    return crud.getUserWorkspaces(userId);
  }

  static async getDefaultWorkspaceForUser(userId: string): Promise<WorkspaceResponse | null> {
    return crud.getDefaultWorkspaceForUser(userId);
  }

  static async deleteWorkspaceBySlug(slug: string, userId: string): Promise<void> {
    return crud.deleteWorkspaceBySlug(slug, userId);
  }

  // Access & Permission Operations
  static async getWorkspaceBySlug(slug: string, userId: string): Promise<WorkspaceWithAccess | null> {
    return access.getWorkspaceBySlug(slug, userId);
  }

  static async validateWorkspaceAccess(slug: string, userId: string): Promise<WorkspaceAccessValidation> {
    return access.validateWorkspaceAccess(slug, userId);
  }

  static async hasWorkspacePermission(
    slug: string,
    userId: string,
    requiredLevel: keyof typeof import("@/lib/constants").WORKSPACE_PERMISSION_LEVELS,
  ): Promise<boolean> {
    return access.hasWorkspacePermission(slug, userId, requiredLevel);
  }

  static async isWorkspaceOwner(slug: string, userId: string): Promise<boolean> {
    return access.isWorkspaceOwner(slug, userId);
  }

  static async getUserRoleInWorkspace(slug: string, userId: string): Promise<WorkspaceRole | null> {
    return access.getUserRoleInWorkspace(slug, userId);
  }

  // Validation Operations
  static validateWorkspaceSlug(slug: string): SlugValidationResult {
    return validation.validateWorkspaceSlug(slug);
  }

  static validateWorkspaceName(name: string): SlugValidationResult {
    return validation.validateWorkspaceName(name);
  }

  static validateWorkspaceDescription(description?: string): SlugValidationResult {
    return validation.validateWorkspaceDescription(description);
  }

  static validateWorkspaceData(data: {
    name: string;
    slug: string;
    description?: string;
  }): SlugValidationResult {
    return validation.validateWorkspaceData(data);
  }
}

// Also export individual modules for granular access if needed
export { crud, access, validation };