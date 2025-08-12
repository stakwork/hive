import {
  CreateWorkspaceRequest,
  WorkspaceResponse,
  WorkspaceWithRole,
  WorkspaceWithAccess,
  WorkspaceAccessValidation,
  WorkspaceRole,
} from "@/types/workspace";

// Import all modules
import * as crud from "./workspace-crud";
import * as access from "./workspace-access";
import * as validation from "./workspace-validation";
import * as members from "./workspace-members";

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

  // Validation Operations
  static validateWorkspaceSlug(slug: string): { isValid: boolean; error?: string } {
    return validation.validateWorkspaceSlug(slug);
  }

  // Member Management Operations
  static async getWorkspaceMembers(workspaceId: string) {
    return members.getWorkspaceMembers(workspaceId);
  }

  static async addWorkspaceMember(workspaceId: string, githubUsername: string, role: WorkspaceRole) {
    return members.addWorkspaceMember(workspaceId, githubUsername, role);
  }

  static async updateWorkspaceMemberRole(workspaceId: string, userId: string, newRole: WorkspaceRole) {
    return members.updateWorkspaceMemberRole(workspaceId, userId, newRole);
  }

  static async removeWorkspaceMember(workspaceId: string, userId: string) {
    return members.removeWorkspaceMember(workspaceId, userId);
  }
}

// Also export individual modules for granular access if needed
export { crud, access, validation, members };