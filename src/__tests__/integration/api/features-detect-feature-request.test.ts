import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/features/detect-feature-request/route';
import {
  createAuthenticatedPostRequest,
  createPostRequest,
} from '@/__tests__/support/helpers/request-builders';
import {
  createTestUser,
  createTestWorkspace,
} from '@/__tests__/support/fixtures';
import { generateUniqueId } from '@/__tests__/support/helpers/ids';
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
} from '@/__tests__/support/helpers/api-assertions';

// Mock the AI module
vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

// Mock the AI provider module
vi.mock('@/lib/ai/provider', () => ({
  getModel: vi.fn(),
  getApiKeyForProvider: vi.fn(() => 'test-api-key'),
}));

import { generateText } from 'ai';
import { getModel } from '@/lib/ai/provider';

describe('POST /api/features/detect-feature-request - Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mock model
    vi.mocked(getModel).mockResolvedValue({
      modelId: 'claude-3-haiku-20240307',
      provider: 'anthropic',
    } as any);
  });

  describe('Authentication & Authorization', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const owner = await createTestUser({
        email: generateUniqueId('owner') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: owner.id,
      });

      const request = createPostRequest('/api/features/detect-feature-request', {
        chunk: 'hive, create a feature for user authentication',
        workspaceSlug: workspace.slug,
      });

      const response = await POST(request);

      await expectUnauthorized(response);
    });
  });

  describe('Input Validation', () => {
    it('should return 400 when chunk is missing', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          workspaceSlug: workspace.slug,
        }
      );

      const response = await POST(request);

      await expectError(response, 'Missing required fields: chunk, workspaceSlug', 400);
    });

    it('should return 400 when workspaceSlug is missing', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          chunk: 'hive, create a feature',
        }
      );

      const response = await POST(request);

      await expectError(response, 'Missing required fields: chunk, workspaceSlug', 400);
    });

    it('should return 400 when chunk is not a string', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          chunk: 123,
          workspaceSlug: workspace.slug,
        }
      );

      const response = await POST(request);

      await expectError(response, 'Chunk must be a non-empty string', 400);
    });

    it('should return 400 when chunk is empty string', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          chunk: '   ',
          workspaceSlug: workspace.slug,
        }
      );

      const response = await POST(request);

      await expectError(response, 'Chunk must be a non-empty string', 400);
    });
  });

  describe('Feature Request Detection Logic', () => {
    it('should detect valid feature request with wake word', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      // Mock AI response for feature request
      vi.mocked(generateText).mockResolvedValue({
        text: 'yes',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
      } as any);

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          chunk: 'hive, create a feature for user authentication',
          workspaceSlug: workspace.slug,
        }
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.isFeatureRequest).toBe(true);

      // Verify AI was called with correct parameters
      expect(generateText).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(generateText).mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.1);
      expect(callArgs.prompt).toContain('hive, create a feature for user authentication');
    });

    it('should not detect feature request for non-feature commands', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      // Mock AI response for non-feature request
      vi.mocked(generateText).mockResolvedValue({
        text: 'no',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
      } as any);

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          chunk: 'hive, what is the weather today?',
          workspaceSlug: workspace.slug,
        }
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.isFeatureRequest).toBe(false);

      expect(generateText).toHaveBeenCalledTimes(1);
    });

    it('should handle various feature request phrasings', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      const testCases = [
        { input: 'hive, make a feature from this', expectedDetection: true },
        { input: 'hive, build this feature', expectedDetection: true },
        { input: 'hive, can you create a feature for login', expectedDetection: true },
        { input: 'hive, add a new feature', expectedDetection: true },
      ];

      for (const testCase of testCases) {
        vi.clearAllMocks();

        // Mock appropriate response
        vi.mocked(generateText).mockResolvedValue({
          text: testCase.expectedDetection ? 'yes' : 'no',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5 },
        } as any);

        const request = createAuthenticatedPostRequest(
          '/api/features/detect-feature-request',
          user,
          {
            chunk: testCase.input,
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);

        const data = await expectSuccess(response, 200);
        expect(data.isFeatureRequest).toBe(testCase.expectedDetection);
      }
    });

    it('should handle AI response variations (case insensitive)', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      // Test case variations: YES, Yes, yes with whitespace
      const responseVariations = ['YES', 'Yes', ' yes ', 'yes\n'];

      for (const aiResponse of responseVariations) {
        vi.clearAllMocks();

        vi.mocked(generateText).mockResolvedValue({
          text: aiResponse,
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5 },
        } as any);

        const request = createAuthenticatedPostRequest(
          '/api/features/detect-feature-request',
          user,
          {
            chunk: 'hive, create a feature',
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);

        const data = await expectSuccess(response, 200);
        expect(data.isFeatureRequest).toBe(true);
      }
    });
  });

  describe('Error Handling', () => {
    it('should gracefully handle AI service failures and return false', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      // Mock AI failure
      vi.mocked(generateText).mockRejectedValue(
        new Error('AI service unavailable')
      );

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          chunk: 'hive, create a feature',
          workspaceSlug: workspace.slug,
        }
      );

      const response = await POST(request);

      // detectFeatureRequest() fails gracefully - returns false instead of throwing
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.isFeatureRequest).toBe(false);
    });

    it('should gracefully handle getModel failures and return false', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      // Mock model retrieval failure
      vi.mocked(getModel).mockRejectedValue(
        new Error('Failed to load model')
      );

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          chunk: 'hive, create a feature',
          workspaceSlug: workspace.slug,
        }
      );

      const response = await POST(request);

      // detectFeatureRequest() fails gracefully - returns false instead of throwing
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.isFeatureRequest).toBe(false);
    });

    it('should handle malformed JSON in request body', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      // Create request with invalid body that will fail JSON parsing
      const url = 'http://localhost:3000/api/features/detect-feature-request';
      const request = new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-middleware-user-id': user.id,
          'x-middleware-user-email': user.email,
          'x-middleware-user-name': user.name || '',
          'x-middleware-auth-status': 'authenticated',
          'x-middleware-request-id': crypto.randomUUID(),
        },
        body: 'invalid json{',
      });

      const response = await POST(request as any);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long chunk text', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      vi.mocked(generateText).mockResolvedValue({
        text: 'yes',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 5 },
      } as any);

      const longChunk = 'hive, create a feature ' + 'a'.repeat(1000);

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          chunk: longChunk,
          workspaceSlug: workspace.slug,
        }
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.isFeatureRequest).toBe(true);
    });

    it('should handle special characters in chunk', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      vi.mocked(generateText).mockResolvedValue({
        text: 'yes',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
      } as any);

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          chunk: 'hive, create a feature with <html> & "quotes" and \'apostrophes\'',
          workspaceSlug: workspace.slug,
        }
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    it('should handle chunk without wake word', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      // AI should still process it, but might return 'no'
      vi.mocked(generateText).mockResolvedValue({
        text: 'no',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
      } as any);

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          chunk: 'create a feature for me',
          workspaceSlug: workspace.slug,
        }
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      // AI determines the result, not hardcoded logic
      expect(data.isFeatureRequest).toBe(false);
    });

    it('should handle ambiguous AI responses gracefully', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      // AI returns something unexpected
      vi.mocked(generateText).mockResolvedValue({
        text: 'maybe',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
      } as any);

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          chunk: 'hive, create a feature',
          workspaceSlug: workspace.slug,
        }
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      // Should default to false for non-"yes" responses
      expect(data.isFeatureRequest).toBe(false);
    });
  });

  describe('API Response Structure', () => {
    it('should return correct response structure on success', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      vi.mocked(generateText).mockResolvedValue({
        text: 'yes',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
      } as any);

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          chunk: 'hive, create a feature',
          workspaceSlug: workspace.slug,
        }
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      
      // Verify response structure
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('isFeatureRequest');
      expect(typeof data.success).toBe('boolean');
      expect(typeof data.isFeatureRequest).toBe('boolean');
    });

    it('should return error structure on failure', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      const request = createAuthenticatedPostRequest(
        '/api/features/detect-feature-request',
        user,
        {
          workspaceSlug: workspace.slug,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
    });
  });
});
