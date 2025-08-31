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
