export interface EnsureWebhookParams {
  userId: string;
  workspaceId: string;
  repositoryUrl: string;
  callbackUrl: string;
  events?: string[];
  active?: boolean;
}

export interface DeleteWebhookParams {
  userId: string;
  repositoryUrl: string;
  workspaceId: string;
}

export interface GitHubContributor {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
  contributions: number;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  created_at: string;
  updated_at: string;
  html_url: string;
  user: {
    login: string;
    avatar_url: string;
  };
}

export interface RepositoryData {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  language: string | null;
  topics: string[];
  created_at: string;
  updated_at: string;
  contributors: GitHubContributor[];
  recent_issues: GitHubIssue[];
}
