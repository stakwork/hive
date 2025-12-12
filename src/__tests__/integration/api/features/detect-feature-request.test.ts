import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/features/detect-feature-request/route';
import { db } from '@/lib/db';
import {
  createTestUser,
  createTestWorkspace,
} from '@/__tests__/support/fixtures';
import {
  createAuthenticatedPostRequest,
  createPostRequest,
  generateUniqueId,
} from '@/__tests__/support/helpers';
import type { User, Workspace } from '@prisma/client';
import { detectFeatureRequest } from '@/lib/ai/wake-word-detector';

// Mock the wake-word-detector module
vi.mock('@/lib/ai/wake-word-detector', () => ({
  detectFeatureRequest: vi.fn(),
}));

describe('POST /api/features/detect-feature-request - Authentication', () => {
  let user: User;
  let workspace: Workspace;

  beforeEach(async () => {
    user = await createTestUser({
      name: 'Detect Feature Test User',
      email: `detect-feature-${generateUniqueId('user')}@example.com`,
    });

    workspace = await createTestWorkspace({
      name: 'Detect Feature Workspace',
      slug: `detect-feature-${generateUniqueId('workspace')}`,
      ownerId: user.id,
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: 'OWNER',
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 for unauthenticated requests', async () => {
    const request = createPostRequest('/api/features/detect-feature-request', {
      chunk: 'hive, make a feature from this',
      workspaceSlug: workspace.slug,
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('should allow authenticated requests', async () => {
    vi.mocked(detectFeatureRequest).mockResolvedValue(true);

    const request = createAuthenticatedPostRequest(
      '/api/features/detect-feature-request',
      {
        chunk: 'hive, make a feature from this',
        workspaceSlug: workspace.slug,
      },
      user
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.isFeatureRequest).toBe(true);
  });
});

describe('POST /api/features/detect-feature-request - Input Validation', () => {
  let user: User;
  let workspace: Workspace;

  beforeEach(async () => {
    user = await createTestUser({
      name: 'Validation Test User',
      email: `validation-${generateUniqueId('user')}@example.com`,
    });

    workspace = await createTestWorkspace({
      name: 'Validation Workspace',
      slug: `validation-${generateUniqueId('workspace')}`,
      ownerId: user.id,
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: 'OWNER',
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 when chunk is missing', async () => {
    const request = createAuthenticatedPostRequest(
      '/api/features/detect-feature-request',
      {
        workspaceSlug: workspace.slug,
      },
      user
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Missing required fields');
  });

  it('should return 400 when workspaceSlug is missing', async () => {
    const request = createAuthenticatedPostRequest(
      '/api/features/detect-feature-request',
      {
        chunk: 'hive, make a feature',
      },
      user
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Missing required fields');
  });

  it('should return 400 when chunk is not a string', async () => {
    const request = createAuthenticatedPostRequest(
      '/api/features/detect-feature-request',
      {
        chunk: 123,
        workspaceSlug: workspace.slug,
      },
      user
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Chunk must be a non-empty string');
  });

  it('should return 400 when chunk is an empty string', async () => {
    const request = createAuthenticatedPostRequest(
      '/api/features/detect-feature-request',
      {
        chunk: '',
        workspaceSlug: workspace.slug,
      },
      user
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    // Empty string is caught by the !chunk check, so error message is about missing fields
    expect(data.error).toContain('Missing required fields');
  });

  it('should return 400 when chunk is only whitespace', async () => {
    const request = createAuthenticatedPostRequest(
      '/api/features/detect-feature-request',
      {
        chunk: '   ',
        workspaceSlug: workspace.slug,
      },
      user
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Chunk must be a non-empty string');
  });
});

describe('POST /api/features/detect-feature-request - Feature Detection', () => {
  let user: User;
  let workspace: Workspace;

  beforeEach(async () => {
    user = await createTestUser({
      name: 'Detection Test User',
      email: `detection-${generateUniqueId('user')}@example.com`,
    });

    workspace = await createTestWorkspace({
      name: 'Detection Workspace',
      slug: `detection-${generateUniqueId('workspace')}`,
      ownerId: user.id,
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: 'OWNER',
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should detect feature request when AI returns true', async () => {
    vi.mocked(detectFeatureRequest).mockResolvedValue(true);

    const request = createAuthenticatedPostRequest(
      '/api/features/detect-feature-request',
      {
        chunk: 'hive, make a feature from this conversation',
        workspaceSlug: workspace.slug,
      },
      user
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.isFeatureRequest).toBe(true);

    // Verify detectFeatureRequest was called with correct params
    expect(detectFeatureRequest).toHaveBeenCalledWith(
      'hive, make a feature from this conversation',
      workspace.slug
    );
  });

  it('should not detect feature request when AI returns false', async () => {
    vi.mocked(detectFeatureRequest).mockResolvedValue(false);

    const request = createAuthenticatedPostRequest(
      '/api/features/detect-feature-request',
      {
        chunk: 'hive, what is the weather today?',
        workspaceSlug: workspace.slug,
      },
      user
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.isFeatureRequest).toBe(false);

    // Verify detectFeatureRequest was called with correct params
    expect(detectFeatureRequest).toHaveBeenCalledWith(
      'hive, what is the weather today?',
      workspace.slug
    );
  });

  it('should handle various wake word commands correctly', async () => {
    const testCases = [
      { chunk: 'hive, create a feature', expected: true },
      { chunk: 'hive, build this', expected: true },
      { chunk: 'hive, can you create a feature for login?', expected: true },
      { chunk: 'hive, what time is it?', expected: false },
      { chunk: 'hive, tell me about the project', expected: false },
    ];

    for (const testCase of testCases) {
      vi.mocked(detectFeatureRequest).mockResolvedValue(testCase.expected);

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        {
          chunk: testCase.chunk,
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.isFeatureRequest).toBe(testCase.expected);
      expect(detectFeatureRequest).toHaveBeenCalledWith(testCase.chunk, workspace.slug);
      vi.clearAllMocks();
    }
  });

  it('should pass workspaceSlug to detectFeatureRequest', async () => {
    vi.mocked(detectFeatureRequest).mockResolvedValue(true);

    const request = createAuthenticatedPostRequest(
      '/api/features/detect-feature-request',
      {
        chunk: 'hive, make a feature',
        workspaceSlug: workspace.slug,
      },
      user
    );

    await POST(request);

    expect(detectFeatureRequest).toHaveBeenCalledWith(
      'hive, make a feature',
      workspace.slug
    );
  });
});

describe('POST /api/features/detect-feature-request - Error Handling', () => {
  let user: User;
  let workspace: Workspace;

  beforeEach(async () => {
    user = await createTestUser({
      name: 'Error Test User',
      email: `error-${generateUniqueId('user')}@example.com`,
    });

    workspace = await createTestWorkspace({
      name: 'Error Workspace',
      slug: `error-${generateUniqueId('workspace')}`,
      ownerId: user.id,
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: 'OWNER',
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle malformed JSON in request body gracefully', async () => {
    // Create a request with malformed JSON by constructing manually
    const request = new Request('http://localhost/api/features/detect-feature-request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-middleware-user-id': user.id,
        'x-middleware-user-email': user.email,
        'x-middleware-user-name': user.name || '',
        'x-middleware-auth-status': 'authenticated',
        'x-middleware-request-id': generateUniqueId('request'),
      },
      body: 'invalid json{',
    });

    const response = await POST(request as any);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  it('should handle errors from detectFeatureRequest gracefully', async () => {
    // Note: detectFeatureRequest handles errors internally and returns false,
    // so the endpoint should still return 200 with isFeatureRequest: false
    vi.mocked(detectFeatureRequest).mockResolvedValue(false);

    const request = createAuthenticatedPostRequest(
      '/api/features/detect-feature-request',
      {
        chunk: 'hive, make a feature',
        workspaceSlug: workspace.slug,
      },
      user
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.isFeatureRequest).toBe(false);
  });
});
