export interface WorkspaceConfig {
  slug: string;
  description?: string;
  swarmUrl: string;
  swarmApiKey: string;
  repoUrls: string[];
  pat: string;
}
