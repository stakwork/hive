export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
  slug: string;
  ownerId: string;
}

export interface WorkspaceResponse {
  id: string;
  name: string;
  description?: string | null;
  slug: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

// New types for enhanced workspace functions
export type WorkspaceRole =
  | "OWNER"
  | "ADMIN"
  | "PM"
  | "DEVELOPER"
  | "STAKEHOLDER"
  | "VIEWER";

export interface WorkspaceWithRole extends WorkspaceResponse {
  userRole: WorkspaceRole;
  memberCount: number;
}

export interface WorkspaceWithAccess extends WorkspaceResponse {
  userRole: WorkspaceRole;
  hasKey: boolean;
  owner: {
    id: string;
    name: string | null;
    email: string | null;
  };
  isCodeGraphSetup: boolean;
}

export interface WorkspaceAccessValidation {
  hasAccess: boolean;
  userRole?: WorkspaceRole;
  workspace?: WorkspaceResponse;
  canRead: boolean;
  canWrite: boolean;
  canAdmin: boolean;
}

export interface SlugValidationResult {
  isValid: boolean;
  error?: string;
}
