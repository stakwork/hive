import { vi } from 'vitest';
import { RepositoryStatus, SwarmStatus } from '@prisma/client';

/**
 * Mock factory for creating test swarm data
 */
export const createMockSwarm = (overrides: Partial<any> = {}) => ({
  id: 'test-swarm-id',
  swarmId: 'test-swarm-id',
  name: 'test-swarm',
  workspaceId: 'test-workspace-id',
  repositoryUrl: 'https://github.com/test-owner/test-repo',
  defaultBranch: 'main',
  swarmUrl: 'https://test-swarm.sphinx.chat/api',
  swarmApiKey: JSON.stringify({
    data: 'encrypted_api_key',
    iv: 'test_iv',
    tag: 'test_tag',
    version: '1',
    encryptedAt: '2024-01-01T00:00:00Z',
  }),
  status: SwarmStatus.ACTIVE,
  ...overrides,
});

/**
 * Mock factory for creating test repository data
 */
export const createMockRepository = (overrides: Partial<any> = {}) => ({
  id: 'test-repo-id',
  name: 'test-repo',
  repositoryUrl: 'https://github.com/test-owner/test-repo',
  workspaceId: 'test-workspace-id',
  status: RepositoryStatus.PENDING,
  branch: 'main',
  ...overrides,
});

/**
 * Mock factory for creating test session data
 */
export const createMockSession = (overrides: Partial<any> = {}) => ({
  user: {
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
    ...overrides.user,
  },
  ...overrides,
});

/**
 * Mock factory for creating GitHub credentials
 */
export const createMockGithubCreds = (overrides: Partial<any> = {}) => ({
  username: 'test-username',
  pat: 'test-pat-token',
  ...overrides,
});

/**
 * Mock factory for stakgraph API responses
 */
export const createMockStakgraphResponse = (overrides: Partial<any> = {}) => ({
  ok: true,
  status: 200,
  data: {
    status: 'success',
    request_id: 'test-request-id',
    ...overrides.data,
  },
  ...overrides,
});

/**
 * Mock factory for webhook service responses
 */
export const createMockWebhookResponse = (overrides: Partial<any> = {}) => ({
  id: 123,
  secret: 'webhook-secret',
  ...overrides,
});

/**
 * Mock factory for Next.js request objects
 */
export const createMockRequest = (body: any, overrides: Partial<any> = {}) => {
  return new Request('http://localhost:3000/api/swarm/stakgraph/ingest', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    ...overrides,
  });
};

/**
 * Creates a complete mock setup for successful stakgraph ingestion
 */
export const setupSuccessfulIngestionMocks = () => {
  const mockSession = createMockSession();
  const mockSwarm = createMockSwarm();
  const mockRepository = createMockRepository();
  const mockGithubCreds = createMockGithubCreds();
  const mockStakgraphResponse = createMockStakgraphResponse();
  const mockWebhookResponse = createMockWebhookResponse();

  return {
    mockSession,
    mockSwarm,
    mockRepository,
    mockGithubCreds,
    mockStakgraphResponse,
    mockWebhookResponse,
  };
};

/**
 * Creates mock setup for various failure scenarios
 */
export const setupFailureScenarioMocks = {
  noSession: () => ({
    mockSession: null,
    mockSwarm: createMockSwarm(),
    mockRepository: createMockRepository(),
  }),

  noSwarm: () => ({
    mockSession: createMockSession(),
    mockSwarm: null,
    mockRepository: createMockRepository(),
  }),

  incompleteSwarm: () => ({
    mockSession: createMockSession(),
    mockSwarm: createMockSwarm({ swarmUrl: null, swarmApiKey: null }),
    mockRepository: createMockRepository(),
  }),

  stakgraphApiFailure: () => ({
    mockSession: createMockSession(),
    mockSwarm: createMockSwarm(),
    mockRepository: createMockRepository(),
    mockStakgraphResponse: createMockStakgraphResponse({
      ok: false,
      status: 500,
      data: { error: 'Internal server error' },
    }),
  }),

  webhookFailure: () => ({
    mockSession: createMockSession(),
    mockSwarm: createMockSwarm(),
    mockRepository: createMockRepository(),
    mockStakgraphResponse: createMockStakgraphResponse(),
    webhookError: new Error('Webhook setup failed'),
  }),
};

/**
 * Common assertion helpers for testing ingestion workflow
 */
export const assertionHelpers = {
  /**
   * Assert that authentication was properly validated
   */
  assertAuthenticationValidated: (getServerSessionMock: any, expectedUserId: string) => {
    expect(getServerSessionMock).toHaveBeenCalled();
    // Additional authentication-specific assertions can be added here
  },

  /**
   * Assert that swarm was properly validated
   */
  assertSwarmValidated: (dbSwarmFindFirstMock: any, expectedQuery: any) => {
    expect(dbSwarmFindFirstMock).toHaveBeenCalledWith({ where: expectedQuery });
  },

  /**
   * Assert that repository was properly upserted
   */
  assertRepositoryUpserted: (dbRepositoryUpsertMock: any, expectedParams: any) => {
    expect(dbRepositoryUpsertMock).toHaveBeenCalledWith(expectedParams);
  },

  /**
   * Assert that stakgraph API was called with correct parameters
   */
  assertStakgraphApiCalled: (swarmApiRequestMock: any, expectedParams: any) => {
    expect(swarmApiRequestMock).toHaveBeenCalledWith(expectedParams);
  },

  /**
   * Assert that webhook setup was attempted
   */
  assertWebhookSetupAttempted: (webhookServiceMock: any, expectedParams: any) => {
    expect(webhookServiceMock.ensureRepoWebhook).toHaveBeenCalledWith(expectedParams);
  },

  /**
   * Assert that response has expected structure and status
   */
  assertResponseStructure: (response: Response, expectedStatus: number) => {
    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get('content-type')).toContain('application/json');
  },
};

/**
 * Console spy utilities for testing error logging
 */
export const consoleMocks = {
  mockConsoleError: () => {
    return vi.spyOn(console, 'error').mockImplementation(() => {});
  },

  mockConsoleLog: () => {
    return vi.spyOn(console, 'log').mockImplementation(() => {});
  },

  restoreConsoleMocks: (spies: any[]) => {
    spies.forEach(spy => spy.mockRestore());
  },
};

/**
 * Database mock helpers
 */
export const databaseMocks = {
  setupSuccessfulDatabaseMocks: (db: any, mocks: any) => {
    (db.swarm.findFirst as any).mockResolvedValue(mocks.mockSwarm);
    (db.repository.upsert as any).mockResolvedValue(mocks.mockRepository);
    (db.repository.update as any).mockResolvedValue({
      ...mocks.mockRepository,
      status: RepositoryStatus.SYNCED,
    });
  },

  setupDatabaseErrorMocks: (db: any, error: Error) => {
    (db.swarm.findFirst as any).mockRejectedValue(error);
    (db.repository.upsert as any).mockRejectedValue(error);
    (db.repository.update as any).mockRejectedValue(error);
  },
};

/**
 * External service mock helpers
 */
export const externalServiceMocks = {
  setupSuccessfulExternalMocks: (mocks: any, services: any) => {
    const { 
      getServerSession, 
      getGithubUsernameAndPAT, 
      swarmApiRequest, 
      WebhookService, 
      saveOrUpdateSwarm 
    } = services;

    (getServerSession as any).mockResolvedValue(mocks.mockSession);
    (getGithubUsernameAndPAT as any).mockResolvedValue(mocks.mockGithubCreds);
    (swarmApiRequest as any).mockResolvedValue(mocks.mockStakgraphResponse);
    (saveOrUpdateSwarm as any).mockResolvedValue(undefined);

    const mockWebhookService = {
      ensureRepoWebhook: vi.fn().mockResolvedValue(mocks.mockWebhookResponse),
    };
    (WebhookService as any).mockImplementation(() => mockWebhookService);

    return mockWebhookService;
  },
};