import type { WebhookPayload } from "@/types";

/**
 * Factory for creating webhook payload test fixtures
 */
export const webhookFixtures = {
  /**
   * Create a valid webhook payload with default values
   */
  createValidWebhookPayload: (overrides: Partial<WebhookPayload> = {}): WebhookPayload => ({
    request_id: "ingest-req-123",
    status: "InProgress",
    progress: 50,
    ...overrides,
  }),

  /**
   * Create a complete webhook payload (successful completion)
   */
  createCompleteWebhookPayload: (overrides: Partial<WebhookPayload> = {}): WebhookPayload => ({
    request_id: "ingest-req-456",
    status: "Complete",
    progress: 100,
    result: { nodes: 1234, edges: 5678 },
    completed_at: "2024-01-01T12:00:00Z",
    duration_ms: 60000,
    ...overrides,
  }),

  /**
   * Create a failed webhook payload
   */
  createFailedWebhookPayload: (overrides: Partial<WebhookPayload> = {}): WebhookPayload => ({
    request_id: "ingest-req-789",
    status: "Failed",
    progress: 75,
    error: "Repository not accessible",
    ...overrides,
  }),

  /**
   * Create an in-progress webhook payload
   */
  createInProgressWebhookPayload: (overrides: Partial<WebhookPayload> = {}): WebhookPayload => ({
    request_id: "ingest-req-999",
    status: "InProgress",
    progress: 33,
    ...overrides,
  }),
};

/**
 * Factory for creating swarm test fixtures with encrypted API keys
 */
export const swarmWebhookFixtures = {
  /**
   * Create a valid swarm with encrypted API key for webhook testing
   */
  createValidSwarm: (overrides = {}) => ({
    id: "swarm-123",
    workspaceId: "workspace-123",
    repositoryUrl: "https://github.com/test/repo",
    swarmApiKey: JSON.stringify({
      data: "encrypted-api-key",
      iv: "iv-123",
      tag: "tag-123",
      keyId: "default",
      version: "1",
      encryptedAt: "2024-01-01T00:00:00.000Z",
    }),
    ...overrides,
  }),

  /**
   * Create a swarm without API key (for error testing)
   */
  createSwarmWithoutApiKey: (overrides = {}) => ({
    id: "swarm-no-key",
    workspaceId: "workspace-456",
    repositoryUrl: "https://github.com/test/no-key-repo",
    swarmApiKey: null,
    ...overrides,
  }),
};
