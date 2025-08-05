// Main service class
export { WorkspaceService } from "./WorkspaceService";

// Individual function exports for backward compatibility
export {
  createWorkspace,
  getWorkspacesByUserId,
  getUserWorkspaces,
  getDefaultWorkspaceForUser,
  deleteWorkspaceBySlug,
} from "./workspace-crud";

export {
  getWorkspaceBySlug,
  validateWorkspaceAccess,
  hasWorkspacePermission,
  isWorkspaceOwner,
  getUserRoleInWorkspace,
} from "./workspace-access";

export {
  validateWorkspaceSlug,
  validateWorkspaceName,
  validateWorkspaceDescription,
  validateWorkspaceData,
} from "./workspace-validation";

// Module exports for granular access
export * as WorkspaceCrud from "./workspace-crud";
export * as WorkspaceAccess from "./workspace-access";
export * as WorkspaceValidation from "./workspace-validation";