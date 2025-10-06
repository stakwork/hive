import { vi } from "vitest";

/**
 * Stakwork API test utilities and mocks
 * Used for testing callStakworkAPI function and related stakwork integrations
 */

// Default test configuration values
export const STAKWORK_TEST_CONFIG = {
  STAKWORK_API_KEY: "test-stakwork-key",
  STAKWORK_BASE_URL: "https://test-stakwork.com/api/v1",
  STAKWORK_WORKFLOW_ID: "123,456,789", // live, default, unit/integration
  STAKWORK_JANITOR_WORKFLOW_ID: "111,222,333",
  STAKWORK_USER_JOURNEY_WORKFLOW_ID: "444,555,666",
} as const;

// Common test data factory for callStakworkAPI parameters
export const createStakworkAPIParams = (overrides: Partial<{
  taskId: string;
  message: string;
  contextTags: any[];
  userName: string | null;
  accessToken: string | null;
  swarmUrl: string;
  swarmSecretAlias: string | null;
  poolName: string | null;
  repo2GraphUrl: string;
  attachments: string[];
  mode: string;
  taskSource: string;
}> = {}) => ({
  taskId: "task-123",
  message: "Test message",
  contextTags: [],
  userName: "testuser",
  accessToken: "github_pat_test_token",
  swarmUrl: "https://test-swarm.sphinx.chat/api",
  swarmSecretAlias: "{{SWARM_123_API_KEY}}",
  poolName: "test-pool",
  repo2GraphUrl: "https://test-swarm.sphinx.chat:3355",
  attachments: [],
  mode: "default",
  taskSource: "USER",
  ...overrides,
});

// Mock response factory for stakwork API calls
export const createStakworkResponse = (overrides: Partial<{
  success: boolean;
  data: any;
  error: string;
  project_id: number;
}> = {}) => ({
  success: true,
  data: {
    project_id: 12345,
    workflow_id: 456,
    status: "pending",
  },
  ...overrides,
});

// Setup function for stakwork API mocks
export const setupStakworkMocks = (
  mockFetch: any,
  mockGetBaseUrl: any,
  config = STAKWORK_TEST_CONFIG
) => {
  // Reset all mocks
  vi.clearAllMocks();
  
  // Setup default base URL
  mockGetBaseUrl.mockReturnValue("http://localhost:3000");
  
  // Setup default successful response
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => createStakworkResponse(),
  } as Response);
  
  return { mockFetch, mockGetBaseUrl, config };
};

// Helper to extract and validate stakwork request payload
export const extractStakworkPayload = (mockFetch: any, callIndex = 0) => {
  const call = mockFetch.mock.calls[callIndex];
  if (!call || !call[1] || !call[1].body) {
    throw new Error(`No request body found for call ${callIndex}`);
  }
  
  return JSON.parse(call[1].body as string);
};

// Validate webhook URLs are correctly constructed
export const validateWebhookUrls = (payload: any, baseUrl: string, taskId: string) => {
  const expectedWorkflowWebhook = `${baseUrl}/api/stakwork/webhook?task_id=${taskId}`;
  const expectedResponseWebhook = `${baseUrl}/api/chat/response`;
  
  return {
    workflowWebhookCorrect: payload.webhook_url === expectedWorkflowWebhook,
    responseWebhookCorrect: payload.workflow_params.set_var.attributes.vars.webhookUrl === expectedResponseWebhook,
  };
};

// Workflow ID selection test cases
export const WORKFLOW_MODE_TEST_CASES = [
  { mode: "live", expectedIndex: 0, description: "first workflow ID for live mode" },
  { mode: "default", expectedIndex: 1, description: "second workflow ID for default mode" },
  { mode: "unit", expectedIndex: 2, description: "third workflow ID for unit mode" },
  { mode: "integration", expectedIndex: 2, description: "third workflow ID for integration mode" },
] as const;

// Error response scenarios for testing
export const ERROR_SCENARIOS = [
  { statusText: "Bad Request", code: 400 },
  { statusText: "Unauthorized", code: 401 },
  { statusText: "Forbidden", code: 403 },
  { statusText: "Not Found", code: 404 },
  { statusText: "Internal Server Error", code: 500 },
] as const;

// Edge case test data
export const EDGE_CASE_DATA = {
  nullValues: {
    userName: null,
    accessToken: null,
    swarmSecretAlias: null,
    poolName: null,
  },
  emptyArrays: {
    contextTags: [],
    attachments: [],
  },
  specialMessages: {
    longMessage: "a".repeat(10000),
    specialChars: "Test with 🚀 emojis and chars: àáâäåæçèéêë & <html>",
  },
} as const;
