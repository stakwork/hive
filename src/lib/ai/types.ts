export interface WorkspaceMemberInfo {
  name: string | null;
  githubUsername: string | null;
  role: string;
  description: string | null;
}

export interface WorkspaceConfig {
  slug: string;
  description?: string;
  swarmUrl: string;
  swarmApiKey: string;
  repoUrls: string[];
  pat: string;
  workspaceId: string;
  userId: string;
  members: WorkspaceMemberInfo[];
}
