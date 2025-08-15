import type { WorkspaceRole } from "@prisma/client";

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

// Re-export WorkspaceRole for convenience
export type { WorkspaceRole };

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

// Workspace member types
export interface WorkspaceMemberUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  github: {
    username: string;
    name: string | null;
    bio: string | null;
    publicRepos: number | null;
    followers: number | null;
  } | null;
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: string;
  user: WorkspaceMemberUser;
}

export interface AddWorkspaceMemberRequest {
  githubUsername: string;
  role: WorkspaceRole;
}

export interface UpdateMemberRoleRequest {
  role: WorkspaceRole;
}

export interface UpdateWorkspaceRequest {
  name: string;
  slug: string;
  description?: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
  type: string;
  score: number;
}
