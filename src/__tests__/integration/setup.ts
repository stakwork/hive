import { vi, beforeAll, afterAll } from 'vitest';
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Global test setup
beforeAll(() => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  
  // Mock console methods to reduce noise during testing
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;
  
  // Only suppress in tests unless explicitly testing logging
  global.originalConsole = {
    error: originalError,
    warn: originalWarn,
    log: originalLog,
  };
  
  // Setup global test utilities
  global.testUtils = {
    createMockRequest: (body = {}, headers = {}) => ({
      json: vi.fn().mockResolvedValue(body),
      headers: new Map(Object.entries(headers)),
    }),
    
    createMockSession: (userId = 'test-user-123', overrides = {}) => ({
      user: { 
        id: userId,
        email: 'test@example.com',
        name: 'Test User',
        ...overrides.user 
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      ...overrides,
    }),
    
    createMockSwarmData: (overrides = {}) => ({
      id: 'swarm-123',
      workspaceId: 'workspace-123',
      name: 'test-swarm',
      swarmUrl: 'https://test-swarm.sphinx.chat',
      swarmApiKey: 'encrypted-api-key',
      repositoryUrl: 'https://github.com/owner/repo',
      defaultBranch: 'main',
      ...overrides,
    }),
    
    createMockRepositoryData: (overrides = {}) => ({
      id: 'repo-123',
      name: 'test-repo',
      repositoryUrl: 'https://github.com/owner/repo',
      workspaceId: 'workspace-123',
      status: 'PENDING',
      branch: 'main',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }),
    
    createMockWorkspaceData: (overrides = {}) => ({
      id: 'workspace-123',
      slug: 'test-workspace',
      name: 'Test Workspace',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }),
    
    expectErrorLog: (spy, expectedMessage) => {
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining(expectedMessage),
        expect.any(Error)
      );
    },
    
    mockSuccessfulApiResponse: (data = {}) => ({
      ok: true,
      status: 200,
      data: { request_id: 'test-request-123', ...data },
    }),
    
    mockFailedApiResponse: (status = 500, error = 'Internal server error') => ({
      ok: false,
      status,
      data: { error },
    }),
  };
});

afterAll(() => {
  // Restore original console methods
  if (global.originalConsole) {
    console.error = global.originalConsole.error;
    console.warn = global.originalConsole.warn;
    console.log = global.originalConsole.log;
  }
  
  // Clean up global test utilities
  delete global.testUtils;
  delete global.originalConsole;
});

// Global test configuration
export const testConfig = {
  timeout: 10000, // 10 second timeout for integration tests
  retries: 0, // Don't retry failed tests by default
  
  // Mock data templates
  mockData: {
    validWorkspaceId: 'workspace-123',
    validSwarmId: 'swarm-123',
    validUserId: 'user-123',
    validRepoUrl: 'https://github.com/owner/repo',
    validGithubCredentials: {
      username: 'test-user',
      token: 'github-token',
    },
    validSwarmApiKey: 'encrypted-api-key',
    decryptedApiKey: 'decrypted-api-key',
    webhookCallbackUrl: 'https://example.com/api/github/webhook',
    stakgraphCallbackUrl: 'https://example.com/api/swarm/stakgraph/webhook',
  },
  
  // Common error messages
  errorMessages: {
    unauthorized: 'Unauthorized',
    swarmNotFound: 'Swarm not found',
    workspaceNotFound: 'Workspace not found',
    noRepoUrl: 'No repository URL found',
    noWorkspaceId: 'No repository workspace ID found',
    swarmConfigMissing: 'Swarm URL or API key not set',
    failedToIngest: 'Failed to ingest code',
  },
  
  // HTTP status codes
  statusCodes: {
    ok: 200,
    created: 201,
    accepted: 202,
    badRequest: 400,
    unauthorized: 401,
    forbidden: 403,
    notFound: 404,
    conflict: 409,
    tooManyRequests: 429,
    internalServerError: 500,
    serviceUnavailable: 503,
  },
};

// Type declarations for global utilities
declare global {
  var testUtils: {
    createMockRequest: (body?: any, headers?: Record<string, string>) => any;
    createMockSession: (userId?: string, overrides?: any) => any;
    createMockSwarmData: (overrides?: any) => any;
    createMockRepositoryData: (overrides?: any) => any;
    createMockWorkspaceData: (overrides?: any) => any;
    expectErrorLog: (spy: any, expectedMessage: string) => void;
    mockSuccessfulApiResponse: (data?: any) => any;
    mockFailedApiResponse: (status?: number, error?: string) => any;
  };
  
  var originalConsole: {
    error: typeof console.error;
    warn: typeof console.warn;
    log: typeof console.log;
  };
}

export {};