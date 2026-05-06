export interface WorkspaceMemberInfo {
  name: string | null;
  githubUsername: string | null;
  role: string;
  description: string | null;
}

export interface WorkspaceConfig {
  slug: string;
  /**
   * Human-readable workspace name (e.g. "Graph & Swarm"). The user
   * refers to workspaces by name in chat, while tools and URLs use
   * `slug`. Surfaced in the agent's system prompt so it can recognize
   * the user's natural references without a discovery round-trip.
   */
  name: string;
  description?: string;
  swarmUrl: string;
  swarmApiKey: string;
  repoUrls: string[];
  pat: string;
  workspaceId: string;
  userId: string;
  members: WorkspaceMemberInfo[];
}
