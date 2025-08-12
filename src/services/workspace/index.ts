// Main service class
export { WorkspaceService } from "./WorkspaceService";

// Individual function exports for backward compatibility
export {
  createWorkspace,
  getWorkspacesByUserId,
  getUserWorkspaces,
  getDefaultWorkspaceForUser,
  deleteWorkspaceBySlug,
  softDeleteWorkspace,
} from "./workspace-crud";

export {
  getWorkspaceBySlug,
  validateWorkspaceAccess,
} from "./workspace-access";

export {
  validateWorkspaceSlug,
} from "./workspace-validation";

export {
  getWorkspaceMembers,
  addWorkspaceMember,
  updateWorkspaceMemberRole,
  removeWorkspaceMember,
} from "./workspace-members";

// Module exports for granular access
export * as WorkspaceCrud from "./workspace-crud";
export * as WorkspaceAccess from "./workspace-access";
export * as WorkspaceValidation from "./workspace-validation";
export * as WorkspaceMembers from "./workspace-members";