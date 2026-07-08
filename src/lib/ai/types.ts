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
  /** GitHub handle of the logged-in user sending this request. Undefined for public-viewer requests. */
  currentUserGithubUsername?: string;
  /**
   * The workspace's swarm vanity host (e.g. `swarm38.sphinx.chat`), derived
   * from `Swarm.name` via `getSwarmVanityAddress`. Surfaced in the agent's
   * system prompt so the agent can resolve a user's swarm reference (e.g.
   * "swarm38") back to its workspace.
   *
   * Intentionally distinct from `swarmUrl`: `swarmDomain` is a user-facing
   * matching token, while `swarmUrl` is the internal API endpoint
   * (`https://<hostname>:3355`) that tools actually dial. Do not collapse
   * the two — they serve different purposes.
   */
  swarmDomain?: string;
}
