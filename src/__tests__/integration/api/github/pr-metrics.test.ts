/**
 * Integration tests for PR metrics API endpoint
 * Tests database queries, authentication, and metric calculations end-to-end
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { GET } from '@/app/api/github/pr-metrics/route';
import { db } from '@/lib/db';
import { resetDatabase } from '@/__tests__/support/utilities/database';
import { createAuthenticatedSession, mockSessionAs } from '@/__tests__/support/helpers/auth';
import { createGetRequest } from '@/__tests__/support/helpers/request-builders';
import { generateUniqueId } from '@/__tests__/support/helpers';

// Mock NextAuth session
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));

describe('GET /api/github/pr-metrics', () => {
  let testUser: { id: string; email: string };
  let testWorkspace: { id: string; slug: string };
  let testTask: { id: string };
  let testMessage: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    // Create test user
    testUser = await db.user.create({
      data: {
        email: 'test@example.com',
        name: 'Test User',
      },
    });

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-workspace-${Date.now()}`,
        ownerId: testUser.id,
      },
    });

    // Create test task
    testTask = await db.task.create({
      data: {
        title: 'Test Task',
        workspace: {
          connect: { id: testWorkspace.id }
        },
        createdBy: {
          connect: { id: testUser.id }
        },
        updatedBy: {
          connect: { id: testUser.id }
        }
      },
    });

    // Create test chat message
    testMessage = await db.chatMessage.create({
      data: {
        taskId: testTask.id,
        message: 'Test message',
        role: 'USER',
      },
    });

    // Mock authenticated session
    mockSessionAs(createAuthenticatedSession(testUser));
  });

  describe('Authentication', () => {
    test('should return 401 when user is not authenticated', async () => {
      // Mock unauthenticated session
      mockSessionAs(null);

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    test('should return 400 when workspaceId is missing', async () => {
      const request = createGetRequest('/api/github/pr-metrics', {});

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing required parameter: workspaceId');
    });
  });

  describe('Zero PRs Scenario', () => {
    test('should return null metrics when no PR artifacts exist', async () => {
      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        successRate: null,
        avgTimeToMerge: null,
        prCount: 0,
        mergedCount: 0,
      });
    });
  });

  describe('Below Threshold Scenarios', () => {
    test('should return null successRate with 1 PR (below threshold)', async () => {
      // Create 1 merged PR
      await db.artifact.create({
        data: {
          id: generateUniqueId(),
          messageId: testMessage.id,
          type: 'PULL_REQUEST',
          content: {
            repo: 'test/repo',
            url: 'https://github.com/test/repo/pull/1',
            status: 'DONE',
          },
          createdAt: new Date('2026-01-24T00:00:00Z'),
          updatedAt: new Date('2026-01-24T02:00:00Z'), // 2 hours to merge
        },
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successRate).toBeNull(); // Below threshold
      expect(data.avgTimeToMerge).toBe(2);
      expect(data.prCount).toBe(1);
      expect(data.mergedCount).toBe(1);
    });

    test('should return null successRate with 2 PRs (below threshold)', async () => {
      const now = new Date('2026-01-24T03:00:00Z');

      // Create 2 PRs (1 merged, 1 open)
      await db.artifact.createMany({
        data: [
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/1',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-24T00:00:00Z'),
            updatedAt: new Date('2026-01-24T01:00:00Z'),
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/2',
              status: 'OPEN',
            },
            createdAt: new Date('2026-01-24T01:00:00Z'),
            updatedAt: new Date('2026-01-24T01:00:00Z'),
          },
        ],
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successRate).toBeNull(); // Below threshold
      expect(data.avgTimeToMerge).toBe(1);
      expect(data.prCount).toBe(2);
      expect(data.mergedCount).toBe(1);
    });
  });

  describe('Multiple PRs in Window', () => {
    test('should calculate metrics for 3 merged PRs (at threshold)', async () => {
      const now = new Date('2026-01-24T03:00:00Z');

      // Create 3 merged PRs with different merge times
      await db.artifact.createMany({
        data: [
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/1',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-24T00:00:00Z'),
            updatedAt: new Date('2026-01-24T02:00:00Z'), // 2 hours
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/2',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-24T00:30:00Z'),
            updatedAt: new Date('2026-01-24T04:30:00Z'), // 4 hours
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/3',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-24T01:00:00Z'),
            updatedAt: new Date('2026-01-24T07:00:00Z'), // 6 hours
          },
        ],
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successRate).toBe(100); // 3/3 * 100
      expect(data.avgTimeToMerge).toBe(4); // (2 + 4 + 6) / 3 = 4
      expect(data.prCount).toBe(3);
      expect(data.mergedCount).toBe(3);
    });

    test('should calculate metrics for mixed PR statuses (merged, open, closed)', async () => {
      const now = new Date('2026-01-24T03:00:00Z');

      // Create 5 PRs: 2 merged, 2 open, 1 closed
      await db.artifact.createMany({
        data: [
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/1',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-24T00:00:00Z'),
            updatedAt: new Date('2026-01-24T01:00:00Z'), // 1 hour
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/2',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-24T00:30:00Z'),
            updatedAt: new Date('2026-01-24T03:30:00Z'), // 3 hours
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/3',
              status: 'OPEN',
            },
            createdAt: new Date('2026-01-24T01:00:00Z'),
            updatedAt: new Date('2026-01-24T01:00:00Z'),
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/4',
              status: 'OPEN',
            },
            createdAt: new Date('2026-01-24T01:30:00Z'),
            updatedAt: new Date('2026-01-24T01:30:00Z'),
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/5',
              status: 'CLOSED',
            },
            createdAt: new Date('2026-01-24T02:00:00Z'),
            updatedAt: new Date('2026-01-24T02:30:00Z'),
          },
        ],
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successRate).toBe(40); // 2/5 * 100
      expect(data.avgTimeToMerge).toBe(2); // (1 + 3) / 2 = 2
      expect(data.prCount).toBe(5);
      expect(data.mergedCount).toBe(2);
    });
  });

  describe('Time Window Filtering', () => {
    test('should only include PRs from last 72 hours', async () => {
      const now = new Date('2026-01-24T03:45:00Z'); // Current time
      const seventyTwoHoursAgo = new Date('2026-01-21T03:45:00Z');
      const beforeWindow = new Date('2026-01-21T03:00:00Z'); // Just before 72h window

      // Create PRs inside and outside the 72-hour window
      await db.artifact.createMany({
        data: [
          // Inside window (should be included)
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/1',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-24T00:00:00Z'),
            updatedAt: new Date('2026-01-24T02:00:00Z'),
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/2',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-22T00:00:00Z'),
            updatedAt: new Date('2026-01-22T01:00:00Z'),
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/3',
              status: 'OPEN',
            },
            createdAt: new Date('2026-01-23T00:00:00Z'),
            updatedAt: new Date('2026-01-23T00:00:00Z'),
          },
          // Outside window (should be excluded)
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/4',
              status: 'DONE',
            },
            createdAt: beforeWindow,
            updatedAt: new Date('2026-01-21T05:00:00Z'),
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/5',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-20T00:00:00Z'),
            updatedAt: new Date('2026-01-20T02:00:00Z'),
          },
        ],
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Only the 3 PRs within the window should be counted
      expect(data.prCount).toBe(3);
      expect(data.mergedCount).toBe(2);
      expect(data.successRate).toBe(66.67);
    });
  });

  describe('Workspace Isolation', () => {
    test('should only return PRs from specified workspace', async () => {
      // Create another workspace
      const otherWorkspace = await db.workspace.create({
        data: {
          name: 'Other Workspace',
          slug: `other-workspace-${Date.now()}`,
          ownerId: testUser.id,
        },
      });

      // Create task in other workspace
      const otherTask = await db.task.create({
        data: {
          title: 'Other Task',
          workspace: {
            connect: { id: otherWorkspace.id }
          },
          createdBy: {
            connect: { id: testUser.id }
          },
          updatedBy: {
            connect: { id: testUser.id }
          }
        },
      });

      // Create message in other task
      const otherMessage = await db.chatMessage.create({
        data: {
          taskId: otherTask.id,
          message: 'Other message',
          role: 'USER',
        },
      });

      // Create PRs in both workspaces
      await db.artifact.createMany({
        data: [
          // Test workspace PRs
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/1',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-24T00:00:00Z'),
            updatedAt: new Date('2026-01-24T02:00:00Z'),
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/2',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-24T01:00:00Z'),
            updatedAt: new Date('2026-01-24T03:00:00Z'),
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/3',
              status: 'OPEN',
            },
            createdAt: new Date('2026-01-24T02:00:00Z'),
            updatedAt: new Date('2026-01-24T02:00:00Z'),
          },
          // Other workspace PRs (should be excluded)
          {
            id: generateUniqueId(),
            messageId: otherMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'other/repo',
              url: 'https://github.com/other/repo/pull/1',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-24T00:00:00Z'),
            updatedAt: new Date('2026-01-24T01:00:00Z'),
          },
          {
            id: generateUniqueId(),
            messageId: otherMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'other/repo',
              url: 'https://github.com/other/repo/pull/2',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-24T01:00:00Z'),
            updatedAt: new Date('2026-01-24T02:00:00Z'),
          },
        ],
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Only test workspace PRs should be counted
      expect(data.prCount).toBe(3);
      expect(data.mergedCount).toBe(2);
      expect(data.successRate).toBe(66.67);
    });
  });

  describe('Non-PR Artifacts Filtering', () => {
    test('should only count PULL_REQUEST type artifacts', async () => {
      // Create various artifact types
      await db.artifact.createMany({
        data: [
          // PR artifacts (should be included)
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/1',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-24T00:00:00Z'),
            updatedAt: new Date('2026-01-24T02:00:00Z'),
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/2',
              status: 'DONE',
            },
            createdAt: new Date('2026-01-24T01:00:00Z'),
            updatedAt: new Date('2026-01-24T03:00:00Z'),
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'PULL_REQUEST',
            content: {
              repo: 'test/repo',
              url: 'https://github.com/test/repo/pull/3',
              status: 'OPEN',
            },
            createdAt: new Date('2026-01-24T02:00:00Z'),
            updatedAt: new Date('2026-01-24T02:00:00Z'),
          },
          // Other artifact types (should be excluded)
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'DIFF',
            content: {
              diffs: [],
            },
            createdAt: new Date('2026-01-24T00:00:00Z'),
            updatedAt: new Date('2026-01-24T00:00:00Z'),
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'CODE',
            content: {
              content: 'const x = 1;',
              language: 'typescript',
            },
            createdAt: new Date('2026-01-24T01:00:00Z'),
            updatedAt: new Date('2026-01-24T01:00:00Z'),
          },
        ],
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Only PR artifacts should be counted
      expect(data.prCount).toBe(3);
      expect(data.mergedCount).toBe(2);
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      // Mock database error
      const originalFindMany = db.artifact.findMany;
      vi.spyOn(db.artifact, 'findMany').mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal server error');

      // Restore original function
      db.artifact.findMany = originalFindMany;
    });
  });
});
