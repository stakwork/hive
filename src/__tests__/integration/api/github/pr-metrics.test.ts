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

// Test constants - Centralized configuration for test behavior
const TEST_CONSTANTS = {
  // Metric calculation thresholds
  MIN_PRS_FOR_SUCCESS_RATE: 3, // Minimum PRs needed to calculate success rate
  TIME_WINDOW_HOURS: 72, // Window for PR metrics (3 days)

  // Time durations for test scenarios
  MERGE_TIME: {
    SHORT: 1, // hours
    MEDIUM: 2, // hours
    LONG_FIRST: 4, // hours
    LONG_SECOND: 6, // hours
  },

  // Expected test outcomes
  EXPECTED: {
    FULL_SUCCESS_RATE: 100, // 3 merged / 3 total
    PARTIAL_SUCCESS_RATE: 40, // 2 merged / 5 total
    TWO_THIRDS_SUCCESS_RATE: 66.67, // 2 merged / 3 total
    AVG_TIME_SHORT_MEDIUM: 2, // (1 + 3) / 2
    AVG_TIME_ALL_LONG: 4, // (2 + 4 + 6) / 3
  },

  // PR counts for test scenarios
  PR_COUNT: {
    SINGLE: 1,
    PAIR: 2,
    THRESHOLD: 3,
    MIXED_STATUS: 5,
  },
} as const;

/**
 * Helper to create dates relative to a base time
 * Avoids hardcoded dates and makes test intentions clear
 */
const createTestDates = (baseTime: Date = new Date()) => {
  const hoursAgo = (hours: number) => new Date(baseTime.getTime() - hours * 60 * 60 * 1000);
  const hoursFromNow = (hours: number) => new Date(baseTime.getTime() + hours * 60 * 60 * 1000);
  const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 60 * 60 * 1000);

  return {
    now: baseTime,
    hoursAgo,
    hoursFromNow,
    addHours,
    windowStart: hoursAgo(TEST_CONSTANTS.TIME_WINDOW_HOURS),
    beforeWindow: hoursAgo(TEST_CONSTANTS.TIME_WINDOW_HOURS + 1),
  };
};

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
      const dates = createTestDates();
      const createdAt = dates.hoursAgo(10);
      const updatedAt = dates.addHours(createdAt, TEST_CONSTANTS.MERGE_TIME.MEDIUM);

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
          createdAt,
          updatedAt,
        },
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successRate).toBeNull(); // Below MIN_PRS_FOR_SUCCESS_RATE threshold
      expect(data.avgTimeToMerge).toBe(TEST_CONSTANTS.MERGE_TIME.MEDIUM);
      expect(data.prCount).toBe(TEST_CONSTANTS.PR_COUNT.SINGLE);
      expect(data.mergedCount).toBe(TEST_CONSTANTS.PR_COUNT.SINGLE);
    });

    test('should return null successRate with 2 PRs (below threshold)', async () => {
      const dates = createTestDates();
      const pr1Created = dates.hoursAgo(15);
      const pr1Updated = dates.addHours(pr1Created, TEST_CONSTANTS.MERGE_TIME.SHORT);
      const pr2Created = dates.hoursAgo(10);

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
            updatedAt: pr1Updated,
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
      expect(data.successRate).toBeNull(); // Below MIN_PRS_FOR_SUCCESS_RATE threshold
      expect(data.avgTimeToMerge).toBe(TEST_CONSTANTS.MERGE_TIME.SHORT);
      expect(data.prCount).toBe(TEST_CONSTANTS.PR_COUNT.PAIR);
      expect(data.mergedCount).toBe(TEST_CONSTANTS.PR_COUNT.SINGLE);
    });
  });

  describe('Multiple PRs in Window', () => {
    test('should calculate metrics for 3 merged PRs (at threshold)', async () => {
      const dates = createTestDates();
      
      // PR 1: Created 20h ago, merged after 2h
      const pr1Created = dates.hoursAgo(20);
      const pr1Updated = dates.addHours(pr1Created, TEST_CONSTANTS.MERGE_TIME.MEDIUM);
      
      // PR 2: Created 18h ago, merged after 4h
      const pr2Created = dates.hoursAgo(18);
      const pr2Updated = dates.addHours(pr2Created, TEST_CONSTANTS.MERGE_TIME.LONG_FIRST);
      
      // PR 3: Created 15h ago, merged after 6h
      const pr3Created = dates.hoursAgo(15);
      const pr3Updated = dates.addHours(pr3Created, TEST_CONSTANTS.MERGE_TIME.LONG_SECOND);

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
            updatedAt: pr1Updated,
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
            updatedAt: pr2Updated,
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
            updatedAt: pr3Updated,
          },
        ],
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successRate).toBe(TEST_CONSTANTS.EXPECTED.FULL_SUCCESS_RATE);
      expect(data.avgTimeToMerge).toBe(TEST_CONSTANTS.EXPECTED.AVG_TIME_ALL_LONG);
      expect(data.prCount).toBe(TEST_CONSTANTS.PR_COUNT.THRESHOLD);
      expect(data.mergedCount).toBe(TEST_CONSTANTS.PR_COUNT.THRESHOLD);
    });

    test('should calculate metrics for mixed PR statuses (merged, open, closed)', async () => {
      const dates = createTestDates();
      const threeHours = 3;
      
      // PR 1: Created 25h ago, merged after 1h
      const pr1Created = dates.hoursAgo(25);
      const pr1Updated = dates.addHours(pr1Created, TEST_CONSTANTS.MERGE_TIME.SHORT);
      
      // PR 2: Created 20h ago, merged after 3h
      const pr2Created = dates.hoursAgo(20);
      const pr2Updated = dates.addHours(pr2Created, threeHours);
      
      // PR 3-5: Various open/closed states within window
      const pr3Created = dates.hoursAgo(15);
      const pr4Created = dates.hoursAgo(12);
      const pr5Created = dates.hoursAgo(8);
      const pr5Updated = dates.hoursAgo(7); // Closed without merge

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
            updatedAt: pr1Updated,
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
            updatedAt: pr2Updated,
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
            updatedAt: pr5Updated,
          },
        ],
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successRate).toBe(TEST_CONSTANTS.EXPECTED.PARTIAL_SUCCESS_RATE);
      expect(data.avgTimeToMerge).toBe(TEST_CONSTANTS.EXPECTED.AVG_TIME_SHORT_MEDIUM);
      expect(data.prCount).toBe(TEST_CONSTANTS.PR_COUNT.MIXED_STATUS);
      expect(data.mergedCount).toBe(TEST_CONSTANTS.PR_COUNT.PAIR);
    });
  });

  describe('Time Window Filtering', () => {
    test('should only include PRs from last 72 hours', async () => {
      const dates = createTestDates();
      const expectedPRsInWindow = 3;
      const expectedMergedInWindow = 2;
      
      // PRs inside the 72-hour window
      const pr1Created = dates.hoursAgo(10);
      const pr1Updated = dates.addHours(pr1Created, TEST_CONSTANTS.MERGE_TIME.MEDIUM);
      
      const pr2Created = dates.hoursAgo(30);
      const pr2Updated = dates.addHours(pr2Created, TEST_CONSTANTS.MERGE_TIME.SHORT);
      
      const pr3Created = dates.hoursAgo(50);
      
      // PRs outside the 72-hour window (should be excluded)
      const pr4Created = dates.beforeWindow;
      const pr4Updated = dates.addHours(pr4Created, TEST_CONSTANTS.MERGE_TIME.MEDIUM);
      
      const pr5Created = dates.hoursAgo(100);
      const pr5Updated = dates.addHours(pr5Created, TEST_CONSTANTS.MERGE_TIME.MEDIUM);

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
            createdAt: pr1Created,
            updatedAt: pr1Updated,
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
            updatedAt: pr2Updated,
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
            createdAt: pr4Created,
            updatedAt: pr4Updated,
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
            createdAt: pr5Created,
            updatedAt: pr5Updated,
          },
        ],
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.prCount).toBe(expectedPRsInWindow);
      expect(data.mergedCount).toBe(expectedMergedInWindow);
      expect(data.successRate).toBe(TEST_CONSTANTS.EXPECTED.TWO_THIRDS_SUCCESS_RATE);
    });
  });

  describe('Workspace Isolation', () => {
    test('should only return PRs from specified workspace', async () => {
      const dates = createTestDates();
      const expectedTestWorkspacePRs = 3;
      const expectedMergedCount = 2;
      
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

      // Test workspace PRs
      const pr1Created = dates.hoursAgo(15);
      const pr1Updated = dates.addHours(pr1Created, TEST_CONSTANTS.MERGE_TIME.MEDIUM);
      
      const pr2Created = dates.hoursAgo(12);
      const pr2Updated = dates.addHours(pr2Created, TEST_CONSTANTS.MERGE_TIME.MEDIUM);
      
      const pr3Created = dates.hoursAgo(8);
      
      // Other workspace PRs (should be excluded from test workspace query)
      const otherPR1Created = dates.hoursAgo(10);
      const otherPR1Updated = dates.addHours(otherPR1Created, TEST_CONSTANTS.MERGE_TIME.SHORT);
      
      const otherPR2Created = dates.hoursAgo(7);
      const otherPR2Updated = dates.addHours(otherPR2Created, TEST_CONSTANTS.MERGE_TIME.SHORT);

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
            createdAt: pr1Created,
            updatedAt: pr1Updated,
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
            updatedAt: pr2Updated,
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
            createdAt: otherPR1Created,
            updatedAt: otherPR1Updated,
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
            createdAt: otherPR2Created,
            updatedAt: otherPR2Updated,
          },
        ],
      });

      const request = createGetRequest('/api/github/pr-metrics', {
        workspaceId: testWorkspace.id,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.prCount).toBe(expectedTestWorkspacePRs);
      expect(data.mergedCount).toBe(expectedMergedCount);
      expect(data.successRate).toBe(TEST_CONSTANTS.EXPECTED.TWO_THIRDS_SUCCESS_RATE);
    });
  });

  describe('Non-PR Artifacts Filtering', () => {
    test('should only count PULL_REQUEST type artifacts', async () => {
      const dates = createTestDates();
      const expectedPRCount = 3;
      const expectedMergedCount = 2;
      
      // PR creation times
      const pr1Created = dates.hoursAgo(20);
      const pr1Updated = dates.addHours(pr1Created, TEST_CONSTANTS.MERGE_TIME.MEDIUM);
      
      const pr2Created = dates.hoursAgo(15);
      const pr2Updated = dates.addHours(pr2Created, TEST_CONSTANTS.MERGE_TIME.MEDIUM);
      
      const pr3Created = dates.hoursAgo(10);
      
      // Non-PR artifact times (should be ignored)
      const diffCreated = dates.hoursAgo(18);
      const codeCreated = dates.hoursAgo(12);

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
            updatedAt: pr1Updated,
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
            updatedAt: pr2Updated,
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
      expect(data.prCount).toBe(expectedPRCount);
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
