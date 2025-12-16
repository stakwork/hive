import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createAuthenticatedPostRequest,
  createPostRequest,
} from '@/__tests__/support/helpers/request-builders';
import {
  createTestUser,
  createTestWorkspace,
  createTestSwarm,
  createTestRepository,
} from '@/__tests__/support/fixtures';
import { generateUniqueId } from '@/__tests__/support/helpers/ids';
import { WorkspaceRole } from '@prisma/client';
import { POST } from '@/app/api/ask/quick/route';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';

// Mock the AI streaming service
vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

// Mock the AI provider module (wrapper around aieo)
vi.mock('@/lib/ai/provider', () => ({
  getModel: vi.fn(),
  getApiKeyForProvider: vi.fn(() => 'test-api-key'),
}));

// Mock the AI tools
vi.mock('@/lib/ai/askTools', () => ({
  askTools: vi.fn(() => ({})),
  listConcepts: vi.fn(() => Promise.resolve({ features: [] })),
  createHasEndMarkerCondition: vi.fn(() => () => false),
  clueToolMsgs: vi.fn(() => Promise.resolve(null)),
}));

// Mock constants
vi.mock('@/lib/constants/prompt', () => ({
  getQuickAskPrefixMessages: vi.fn(() => []),
}));

// Mock Pusher
vi.mock('@/lib/pusher', () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
}));

import { streamText } from 'ai';
import { getModel } from '@/lib/ai/provider';

const encryptionService = EncryptionService.getInstance();

describe('POST /api/ask/quick - Quick Ask Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getModel).mockResolvedValue({
      modelId: 'test-model',
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

      const request = createPostRequest('/api/ask/quick', {
        messages: [{ role: 'user', content: 'test question' }],
        workspaceSlug: workspace.slug,
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return 403 for users not in workspace', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const owner = await createTestUser({
        email: generateUniqueId('owner') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: owner.id,
      });

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: 'test question' }],
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('denied');
    });

    it('should allow workspace members to ask questions', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
        withGitHubAuth: true,
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: 'test-swarm-key',
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: 'https://github.com/test-org/test-repo',
      });

      const mockStream = {
        toUIMessageStreamResponse: vi.fn(() =>
          new Response('test response', {
            headers: { 'Content-Type': 'text/plain' },
          })
        ),
      };

      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: 'What is this project?' }],
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(streamText).toHaveBeenCalled();
    });
  });

  describe('Request Validation', () => {
    it('should return 400 when messages parameter is missing', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('messages');
    });

    it('should return 400 when messages is empty array', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [],
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('messages');
    });

    it('should return 400 when workspaceSlug parameter is missing', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: 'test' }],
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('workspaceSlug');
    });

    it('should return 403 when workspace does not exist', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: 'test' }],
          workspaceSlug: 'non-existent-workspace',
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('Workspace');
    });
  });

  describe('Configuration Requirements', () => {
    it('should return 404 when swarm is not configured', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
        withGitHubAuth: true,
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: 'test' }],
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('Swarm');
    });

    it('should return 404 when swarmUrl is not configured', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
        withGitHubAuth: true,
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      await db.swarm.create({
        data: {
          name: 'test-swarm',
          swarmUrl: null,
          workspaceId: workspace.id,
          status: 'ACTIVE',
        },
      });

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: 'test' }],
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('Swarm URL');
    });

    it('should return 404 when repository is not configured', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
        withGitHubAuth: true,
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: 'test-key',
      });

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: 'test' }],
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('Repository');
    });

    it('should return 404 when user has no GitHub PAT', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
        // No GitHub auth
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: 'test-key',
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: 'https://github.com/test-org/test-repo',
      });

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: 'test' }],
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('PAT');
    });
  });

  describe('AI Service Integration', () => {
    it('should stream AI response with proper format', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
        withGitHubAuth: true,
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: 'test-swarm-key',
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: 'https://github.com/test-org/test-repo',
      });

      const mockStreamResponse = 'AI response stream';
      const mockStream = {
        toUIMessageStreamResponse: vi.fn(() =>
          new Response(mockStreamResponse, {
            headers: { 'Content-Type': 'text/plain' },
          })
        ),
      };

      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: 'What is this project?' }],
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const responseText = await response.text();
      expect(responseText).toBe(mockStreamResponse);
    });

    it('should pass correct parameters to AI service', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
        withGitHubAuth: true,
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: 'test-key',
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: 'https://github.com/test-org/test-repo',
      });

      const mockStream = {
        toUIMessageStreamResponse: vi.fn(() =>
          new Response('test', {
            headers: { 'Content-Type': 'text/plain' },
          })
        ),
      };

      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const messages = [
        { role: 'user', content: 'How does authentication work?' },
      ];

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages,
          workspaceSlug: workspace.slug,
        },
        user
      );

      await POST(request);

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.any(Object),
          tools: expect.any(Object),
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: 'How does authentication work?',
            }),
          ]),
        })
      );
    });

    it('should handle AI service errors gracefully', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
        withGitHubAuth: true,
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: 'test-key',
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: 'https://github.com/test-org/test-repo',
      });

      vi.mocked(streamText).mockImplementation(() => {
        throw new Error('AI service unavailable');
      });

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: 'test' }],
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should support conversation history', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
        withGitHubAuth: true,
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: 'test-key',
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: 'https://github.com/test-org/test-repo',
      });

      const mockStream = {
        toUIMessageStreamResponse: vi.fn(() =>
          new Response('test', {
            headers: { 'Content-Type': 'text/plain' },
          })
        ),
      };

      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const messages = [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
      ];

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages,
          workspaceSlug: workspace.slug,
        },
        user
      );

      await POST(request);

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: 'First question',
            }),
            expect.objectContaining({
              role: 'assistant',
              content: 'First answer',
            }),
            expect.objectContaining({
              role: 'user',
              content: 'Second question',
            }),
          ]),
        })
      );
    });
  });

  describe('Business Logic', () => {
    it('should handle different workspace roles consistently', async () => {
      const owner = await createTestUser({
        email: generateUniqueId('owner') + '@example.com',
        withGitHubAuth: true,
      });

      const developer = await createTestUser({
        email: generateUniqueId('developer') + '@example.com',
        withGitHubAuth: true,
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: owner.id,
      });

      // Add developer as a workspace member
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: developer.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: 'test-key',
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: 'https://github.com/test-org/test-repo',
      });

      const mockStream = {
        toUIMessageStreamResponse: vi.fn(() =>
          new Response('test response', {
            headers: { 'Content-Type': 'text/plain' },
          })
        ),
      };

      vi.mocked(streamText).mockReturnValue(mockStream as any);

      // Test owner access
      const ownerRequest = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: 'test' }],
          workspaceSlug: workspace.slug,
        },
        owner
      );

      const ownerResponse = await POST(ownerRequest);
      expect(ownerResponse.status).toBe(200);

      // Test developer access
      const developerRequest = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: 'test' }],
          workspaceSlug: workspace.slug,
        },
        developer
      );

      const developerResponse = await POST(developerRequest);
      expect(developerResponse.status).toBe(200);
    });

    it('should handle special characters in messages', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
        withGitHubAuth: true,
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: 'test-key',
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: 'https://github.com/test-org/test-repo',
      });

      const mockStream = {
        toUIMessageStreamResponse: vi.fn(() =>
          new Response('test response', {
            headers: { 'Content-Type': 'text/plain' },
          })
        ),
      };

      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const specialMessage = 'What is the @user & <component> behavior?';
      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: specialMessage }],
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: specialMessage,
            }),
          ]),
        })
      );
    });

    it('should handle long messages without truncation', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
        withGitHubAuth: true,
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: 'https://test-swarm.sphinx.chat',
        swarmApiKey: 'test-key',
      });

      await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: 'https://github.com/test-org/test-repo',
      });

      const mockStream = {
        toUIMessageStreamResponse: vi.fn(() =>
          new Response('test response', {
            headers: { 'Content-Type': 'text/plain' },
          })
        ),
      };

      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const longMessage =
        'Can you explain in detail how the authentication system works, including the OAuth flow, token management, session handling, and integration with GitHub, as well as how it interacts with the workspace membership system?';

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          messages: [{ role: 'user', content: longMessage }],
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: longMessage,
            }),
          ]),
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should return proper error messages for client consumption', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });

      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });

      const request = createAuthenticatedPostRequest(
        '/api/ask/quick',
        {
          workspaceSlug: workspace.slug,
        },
        user
      );

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(typeof data.error).toBe('string');
      expect(data.error.length).toBeGreaterThan(0);
    });
  });
});
