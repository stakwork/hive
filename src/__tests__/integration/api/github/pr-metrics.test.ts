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
  let mockNow: Date;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
    
<<<<<<< HEAD
=======
    // Mock current time to ensure tests don't create items in the past
    mockNow = new Date('2026-01-25T12:00:00Z');
    vi.setSystemTime(mockNow);

>>>>>>> 79b04c60 (Compute expectedSuccessRate using expectedPrCount and expectedMergedCount and update test mock time handling)
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
      const baseTime = Date.now();
      const createdTime = new Date(baseTime - 2 * 60 * 60 * 1000); // 2 hours ago
      const mergedTime = new Date(baseTime); // Now (2 hours to merge)
      const expectedMergeTimeHours = 2;

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
          createdAt: createdTime,
          updatedAt: mergedTime,
        },
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      const expectedPrCount = 1; // Single PR created above
      const expectedMergedCount = 1; // Single merged PR

      expect(response.status).toBe(200);
      expect(data.successRate).toBeNull(); // Below threshold (need 3+ PRs)
      expect(data.avgTimeToMerge).toBe(expectedMergeTimeHours);
      expect(data.prCount).toBe(expectedPrCount);
      expect(data.mergedCount).toBe(expectedMergedCount);
    });

    test('should return null successRate with 2 PRs (below threshold)', async () => {
      // Create 2 PRs (1 merged, 1 open)
      const baseTime = Date.now();
      const pr1Created = new Date(baseTime - 3 * 60 * 60 * 1000); // 3 hours ago
      const pr1Merged = new Date(baseTime - 2 * 60 * 60 * 1000); // 2 hours ago (1 hour to merge)
      const pr2Created = new Date(baseTime - 2 * 60 * 60 * 1000); // 2 hours ago
      const expectedMergeTimeHours = 1;
      const expectedPrCount = 2; // Two PRs created
      const expectedMergedCount = 1; // Only one is merged

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
            createdAt: pr1Created,
            updatedAt: pr1Merged,
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
            createdAt: pr2Created,
            updatedAt: pr2Created,
          },
        ],
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successRate).toBeNull(); // Below threshold (need 3+ PRs)
      expect(data.avgTimeToMerge).toBe(expectedMergeTimeHours);
      expect(data.prCount).toBe(expectedPrCount);
      expect(data.mergedCount).toBe(expectedMergedCount);
    });
  });

  describe('Multiple PRs in Window', () => {
    test('should calculate metrics for 3 merged PRs (at threshold)', async () => {
      // Create 3 merged PRs with different merge times
      const baseTime = Date.now();
      
      // PR 1: Merged in 2 hours
      const pr1Created = new Date(baseTime - 10 * 60 * 60 * 1000); // 10 hours ago
      const pr1Merged = new Date(baseTime - 8 * 60 * 60 * 1000); // 8 hours ago (2 hours to merge)
      const pr1MergeTimeHours = 2;
      
      // PR 2: Merged in 4 hours
      const pr2Created = new Date(baseTime - 9 * 60 * 60 * 1000); // 9 hours ago
      const pr2Merged = new Date(baseTime - 5 * 60 * 60 * 1000); // 5 hours ago (4 hours to merge)
      const pr2MergeTimeHours = 4;
      
      // PR 3: Merged in 6 hours
      const pr3Created = new Date(baseTime - 8 * 60 * 60 * 1000); // 8 hours ago
      const pr3Merged = new Date(baseTime - 2 * 60 * 60 * 1000); // 2 hours ago (6 hours to merge)
      const pr3MergeTimeHours = 6;
      
      const expectedPrCount = 3; // Three PRs created
      const expectedMergedCount = 3; // All three are merged
      const expectedSuccessRate = 100; // 3/3 * 100
      const expectedAvgMergeTime = 4; // (2 + 4 + 6) / 3 = 4

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
            createdAt: pr1Created,
            updatedAt: pr1Merged,
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
            createdAt: pr2Created,
            updatedAt: pr2Merged,
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
            createdAt: pr3Created,
            updatedAt: pr3Merged,
          },
        ],
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successRate).toBe(expectedSuccessRate);
      expect(data.avgTimeToMerge).toBe(expectedAvgMergeTime);
      expect(data.prCount).toBe(expectedPrCount);
      expect(data.mergedCount).toBe(expectedMergedCount);
    });

    test('should calculate metrics for mixed PR statuses (merged, open, closed)', async () => {
      // Create 5 PRs: 2 merged, 2 open, 1 closed
      const baseTime = Date.now();
      
      // PR 1: Merged in 1 hour
      const pr1Created = new Date(baseTime - 12 * 60 * 60 * 1000); // 12 hours ago
      const pr1Merged = new Date(baseTime - 11 * 60 * 60 * 1000); // 11 hours ago (1 hour to merge)
      const pr1MergeTimeHours = 1;
      
      // PR 2: Merged in 3 hours
      const pr2Created = new Date(baseTime - 10 * 60 * 60 * 1000); // 10 hours ago
      const pr2Merged = new Date(baseTime - 7 * 60 * 60 * 1000); // 7 hours ago (3 hours to merge)
      const pr2MergeTimeHours = 3;
      
      // PR 3: Still open (not merged)
      const pr3Created = new Date(baseTime - 6 * 60 * 60 * 1000); // 6 hours ago
      
      // PR 4: Still open (not merged)
      const pr4Created = new Date(baseTime - 4 * 60 * 60 * 1000); // 4 hours ago
      
      // PR 5: Closed without merging
      const pr5Created = new Date(baseTime - 3 * 60 * 60 * 1000); // 3 hours ago
      const pr5Closed = new Date(baseTime - 2 * 60 * 60 * 1000); // 2 hours ago
      
      const expectedPrCount = 5; // Five PRs created
      const expectedMergedCount = 2; // Only two are merged
      const expectedSuccessRate = 40; // 2/5 * 100
      const expectedAvgMergeTime = 2; // (1 + 3) / 2 = 2

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
            createdAt: pr1Created,
            updatedAt: pr1Merged,
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
            createdAt: pr2Created,
            updatedAt: pr2Merged,
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
            createdAt: pr3Created,
            updatedAt: pr3Created,
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
            createdAt: pr4Created,
            updatedAt: pr4Created,
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
            createdAt: pr5Created,
            updatedAt: pr5Closed,
          },
        ],
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successRate).toBe(expectedSuccessRate);
      expect(data.avgTimeToMerge).toBe(expectedAvgMergeTime);
      expect(data.prCount).toBe(expectedPrCount);
      expect(data.mergedCount).toBe(expectedMergedCount);
    });
  });

  describe('Time Window Filtering', () => {
    test('should only include PRs from last 72 hours', async () => {
      const baseTime = Date.now();
      const windowDurationHours = 72;
      
      // PRs inside the 72-hour window (should be included)
      // PR 1: Created 10 hours ago, merged in 2 hours
      const pr1InsideCreated = new Date(baseTime - 10 * 60 * 60 * 1000); // 10 hours ago
      const pr1InsideMerged = new Date(baseTime - 8 * 60 * 60 * 1000); // 8 hours ago
      
      // PR 2: Created 50 hours ago, merged in 1 hour
      const pr2InsideCreated = new Date(baseTime - 50 * 60 * 60 * 1000); // 50 hours ago
      const pr2InsideMerged = new Date(baseTime - 49 * 60 * 60 * 1000); // 49 hours ago
      
      // PR 3: Created 30 hours ago, still open
      const pr3InsideCreated = new Date(baseTime - 30 * 60 * 60 * 1000); // 30 hours ago
      
      // PRs outside the 72-hour window (should be excluded)
      // PR 4: Created 73.5 hours ago (just outside window)
      const pr4OutsideCreated = new Date(baseTime - 73.5 * 60 * 60 * 1000); // 73.5 hours ago
      const pr4OutsideMerged = new Date(baseTime - 71 * 60 * 60 * 1000); // 71 hours ago
      
      // PR 5: Created 100 hours ago
      const pr5OutsideCreated = new Date(baseTime - 100 * 60 * 60 * 1000); // 100 hours ago
      const pr5OutsideMerged = new Date(baseTime - 98 * 60 * 60 * 1000); // 98 hours ago
      
      const expectedPrsInWindow = 3; // Only PRs 1, 2, 3
      const expectedMergedInWindow = 2; // Only PRs 1, 2
      const expectedSuccessRate = Math.round((expectedMergedInWindow / expectedPrsInWindow) * 100 * 100) / 100; // 2/3 * 100 = 66.67

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
            createdAt: pr1InsideCreated,
            updatedAt: pr1InsideMerged,
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
            createdAt: pr2InsideCreated,
            updatedAt: pr2InsideMerged,
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
            createdAt: pr3InsideCreated,
            updatedAt: pr3InsideCreated,
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
            createdAt: pr4OutsideCreated,
            updatedAt: pr4OutsideMerged,
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
            createdAt: pr5OutsideCreated,
            updatedAt: pr5OutsideMerged,
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
      expect(data.prCount).toBe(expectedPrsInWindow);
      expect(data.mergedCount).toBe(expectedMergedInWindow);
      expect(data.successRate).toBe(expectedSuccessRate);
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

      const baseTime = Date.now();
      
      // Test workspace PRs (should be included in results)
      const testPr1Created = new Date(baseTime - 10 * 60 * 60 * 1000); // 10 hours ago
      const testPr1Merged = new Date(baseTime - 8 * 60 * 60 * 1000); // 8 hours ago (2 hours to merge)
      
      const testPr2Created = new Date(baseTime - 8 * 60 * 60 * 1000); // 8 hours ago
      const testPr2Merged = new Date(baseTime - 6 * 60 * 60 * 1000); // 6 hours ago (2 hours to merge)
      
      const testPr3Created = new Date(baseTime - 5 * 60 * 60 * 1000); // 5 hours ago (still open)
      
      // Other workspace PRs (should be excluded from results)
      const otherPr1Created = new Date(baseTime - 12 * 60 * 60 * 1000); // 12 hours ago
      const otherPr1Merged = new Date(baseTime - 11 * 60 * 60 * 1000); // 11 hours ago
      
      const otherPr2Created = new Date(baseTime - 9 * 60 * 60 * 1000); // 9 hours ago
      const otherPr2Merged = new Date(baseTime - 8 * 60 * 60 * 1000); // 8 hours ago
      
      const expectedPrCount = 3; // Only test workspace PRs
      const expectedMergedCount = 2; // Only test workspace merged PRs
      const expectedSuccessRate = Math.round((expectedMergedCount / expectedPrCount) * 100 * 100) / 100; // 2/3 * 100 = 66.67

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
            createdAt: testPr1Created,
            updatedAt: testPr1Merged,
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
            createdAt: testPr2Created,
            updatedAt: testPr2Merged,
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
            createdAt: testPr3Created,
            updatedAt: testPr3Created,
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
            createdAt: otherPr1Created,
            updatedAt: otherPr1Merged,
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
            createdAt: otherPr2Created,
            updatedAt: otherPr2Merged,
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
      expect(data.prCount).toBe(expectedPrCount);
      expect(data.mergedCount).toBe(expectedMergedCount);
      expect(data.successRate).toBe(expectedSuccessRate);
    });
  });

  describe('Non-PR Artifacts Filtering', () => {
    test('should only count PULL_REQUEST type artifacts', async () => {
      const baseTime = Date.now();
      
      // PR artifacts (should be included)
      // PR 1: Merged in 2 hours
      const pr1Created = new Date(baseTime - 10 * 60 * 60 * 1000); // 10 hours ago
      const pr1Merged = new Date(baseTime - 8 * 60 * 60 * 1000); // 8 hours ago
      
      // PR 2: Merged in 2 hours
      const pr2Created = new Date(baseTime - 8 * 60 * 60 * 1000); // 8 hours ago
      const pr2Merged = new Date(baseTime - 6 * 60 * 60 * 1000); // 6 hours ago
      
      // PR 3: Still open
      const pr3Created = new Date(baseTime - 5 * 60 * 60 * 1000); // 5 hours ago
      
      // Non-PR artifacts (should be excluded)
      const diffCreated = new Date(baseTime - 7 * 60 * 60 * 1000); // 7 hours ago
      const codeCreated = new Date(baseTime - 6 * 60 * 60 * 1000); // 6 hours ago
      
      const expectedPrCount = 3; // Only PULL_REQUEST type artifacts
      const expectedMergedCount = 2; // Only merged PRs
      
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
            createdAt: pr1Created,
            updatedAt: pr1Merged,
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
            createdAt: pr2Created,
            updatedAt: pr2Merged,
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
            createdAt: pr3Created,
            updatedAt: pr3Created,
          },
          // Other artifact types (should be excluded)
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'DIFF',
            content: {
              diffs: [],
            },
            createdAt: diffCreated,
            updatedAt: diffCreated,
          },
          {
            id: generateUniqueId(),
            messageId: testMessage.id,
            type: 'CODE',
            content: {
              content: 'const x = 1;',
              language: 'typescript',
            },
            createdAt: codeCreated,
            updatedAt: codeCreated,
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
      expect(data.prCount).toBe(expectedPrCount);
      expect(data.mergedCount).toBe(expectedMergedCount);
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
