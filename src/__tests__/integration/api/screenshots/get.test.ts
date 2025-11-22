import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/screenshots/route';
import { db } from '@/lib/db';
import {
  createAuthenticatedSession,
  getMockedSession,
} from '@/__tests__/support/helpers/auth';
import { createTestWorkspaceScenario } from '@/__tests__/support/fixtures/workspace';
import { createTestTask } from '@/__tests__/support/fixtures/task';
import { createTestScreenshot as createScreenshotFixture } from '@/__tests__/support/fixtures/screenshot';
import { getServerSession } from 'next-auth/next';

// Mock NextAuth
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));

// Mock S3Service
const mockS3Service = {
  generatePresignedDownloadUrl: vi.fn(),
};

vi.mock('@/services/s3', () => ({
  getS3Service: vi.fn(() => mockS3Service),
}));

describe('GET /api/screenshots Integration Tests', () => {
  let testUser: any;
  let testWorkspace: any;
  let testTask: any;
  let anotherUser: any;
  let anotherWorkspace: any;
  const createdScreenshotIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdTaskIds: string[] = [];

  // Helper to create authenticated session
  const mockAuthenticatedSession = (userId: string) => {
    getMockedSession().mockResolvedValue(
      createAuthenticatedSession({ id: userId, email: 'test@example.com' })
    );
  };

  // Helper to mock unauthenticated session
  const mockUnauthenticatedSession = () => {
    getMockedSession().mockResolvedValue(null);
  };

  // Helper to create test fixtures
  const createTestUserWithWorkspaceAndTask = async () => {
    const scenario = await createTestWorkspaceScenario();
    const user = scenario.owner;
    const workspace = scenario.workspace;

    createdUserIds.push(user.id);
    createdWorkspaceIds.push(workspace.id);

    const task = await createTestTask({
      title: 'Test Task',
      workspaceId: workspace.id,
      createdById: user.id,
    });
    createdTaskIds.push(task.id);

    return { user, workspace, task };
  };

  // Helper to create screenshot with tracking
  const createTestScreenshot = async (data: {
    workspaceId: string;
    taskId?: string;
    pageUrl?: string;
    s3Url?: string;
    urlExpiresAt?: Date;
  }) => {
    const screenshot = await createScreenshotFixture(data);
    createdScreenshotIds.push(screenshot.id);
    return screenshot;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup test fixtures
    const fixtures = await createTestUserWithWorkspaceAndTask();
    testUser = fixtures.user;
    testWorkspace = fixtures.workspace;
    testTask = fixtures.task;

    // Create another user and workspace for authorization tests
    const anotherFixtures = await createTestUserWithWorkspaceAndTask();
    anotherUser = anotherFixtures.user;
    anotherWorkspace = anotherFixtures.workspace;

    // Mock S3 service to return valid presigned URL
    mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
      'https://new-presigned-url.s3.amazonaws.com/test.png'
    );
  });

  afterEach(async () => {
    // Cleanup in reverse order of creation
    if (createdScreenshotIds.length > 0) {
      await db.screenshot.deleteMany({
        where: { id: { in: createdScreenshotIds } },
      });
      createdScreenshotIds.length = 0;
    }

    if (createdTaskIds.length > 0) {
      await db.task.deleteMany({
        where: { id: { in: createdTaskIds } },
      });
      createdTaskIds.length = 0;
    }

    if (createdWorkspaceIds.length > 0) {
      await db.workspace.deleteMany({
        where: { id: { in: createdWorkspaceIds } },
      });
      createdWorkspaceIds.length = 0;
    }

    if (createdUserIds.length > 0) {
      await db.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      createdUserIds.length = 0;
    }
  });

  describe('Authentication', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockUnauthenticatedSession();

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Authentication required');
    });

    it('should return 401 when session is invalid', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: null,
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Authentication required');
    });
  });

  describe('Authorization', () => {
    it('should return 404 for non-existent workspace', async () => {
      mockAuthenticatedSession(testUser.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', 'non-existent-workspace-id');
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Workspace not found or access denied');
    });

    it('should return 404 for soft-deleted workspace', async () => {
      mockAuthenticatedSession(testUser.id);

      // Soft-delete the workspace
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { deleted: true },
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Workspace not found or access denied');

      // Restore workspace for cleanup
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { deleted: false },
      });
    });

    it('should return 404 when user is not workspace owner or member', async () => {
      mockAuthenticatedSession(anotherUser.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Workspace not found or access denied');
    });

    it('should allow access for workspace owner', async () => {
      mockAuthenticatedSession(testUser.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toBeDefined();
      expect(Array.isArray(data.screenshots)).toBe(true);
    });

    it('should allow access for active workspace member', async () => {
      // Add anotherUser as member to testWorkspace
      const member = await db.workspaceMember.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: anotherUser.id,
          role: 'DEVELOPER',
        },
      });

      mockAuthenticatedSession(anotherUser.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toBeDefined();

      // Cleanup
      await db.workspaceMember.delete({ where: { id: member.id } });
    });

    it('should deny access for members who left the workspace', async () => {
      // Add anotherUser as member who left
      const member = await db.workspaceMember.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: anotherUser.id,
          role: 'DEVELOPER',
          leftAt: new Date(),
        },
      });

      mockAuthenticatedSession(anotherUser.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Workspace not found or access denied');

      // Cleanup
      await db.workspaceMember.delete({ where: { id: member.id } });
    });
  });

  describe('Query Parameter Validation', () => {
    it('should return 400 when workspaceId is missing', async () => {
      mockAuthenticatedSession(testUser.id);

      const url = new URL('http://localhost/api/screenshots');
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid request parameters');
      expect(data.details).toBeDefined();
    });

    it('should return 400 when workspaceId is empty string', async () => {
      mockAuthenticatedSession(testUser.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', '');
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid request parameters');
    });

    it('should accept optional taskId parameter', async () => {
      mockAuthenticatedSession(testUser.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('taskId', testTask.id);
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it('should accept optional pageUrl parameter', async () => {
      mockAuthenticatedSession(testUser.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('pageUrl', 'https://example.com');
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it('should validate limit parameter as positive integer', async () => {
      mockAuthenticatedSession(testUser.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '-1');
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid request parameters');
    });

    it('should accept optional cursor parameter', async () => {
      mockAuthenticatedSession(testUser.id);

      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: testTask.id,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('cursor', screenshot.id);
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe('Pagination', () => {
    it('should respect limit parameter', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create 5 screenshots
      for (let i = 0; i < 5; i++) {
        await createTestScreenshot({
          workspaceId: testWorkspace.id,
          taskId: testTask.id,
        });
      }

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '3');
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(3);
    });

    it('should return hasMore=true when more results exist', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create 3 screenshots
      for (let i = 0; i < 3; i++) {
        await createTestScreenshot({
          workspaceId: testWorkspace.id,
          taskId: testTask.id,
        });
      }

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '2');
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(2);
      expect(data.pagination.hasMore).toBe(true);
      expect(data.pagination.nextCursor).toBeDefined();
    });

    it('should return hasMore=false on last page', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create 2 screenshots
      for (let i = 0; i < 2; i++) {
        await createTestScreenshot({
          workspaceId: testWorkspace.id,
          taskId: testTask.id,
        });
      }

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '5');
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(2);
      expect(data.pagination.hasMore).toBe(false);
      expect(data.pagination.nextCursor).toBeNull();
    });

    it('should return valid nextCursor for pagination', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create 3 screenshots
      const screenshots = [];
      for (let i = 0; i < 3; i++) {
        screenshots.push(
          await createTestScreenshot({
            workspaceId: testWorkspace.id,
            taskId: testTask.id,
          })
        );
      }

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '2');
      const request = new Request(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.pagination.nextCursor).toBeDefined();
      expect(typeof data.pagination.nextCursor).toBe('string');
      expect(data.pagination.nextCursor).toBe(data.screenshots[1].id);
    });

    it('should fetch next page using cursor', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create 3 screenshots with delays to ensure different createdAt times
      const screenshots = [];
      for (let i = 0; i < 3; i++) {
        screenshots.push(
          await createTestScreenshot({
            workspaceId: testWorkspace.id,
            taskId: testTask.id,
          })
        );
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Get first page
      const url1 = new URL('http://localhost/api/screenshots');
      url1.searchParams.set('workspaceId', testWorkspace.id);
      url1.searchParams.set('limit', '1');
      const request1 = new Request(url1.toString());

      const response1 = await GET(request1);
      const data1 = await response1.json();

      // Get second page using cursor
      const url2 = new URL('http://localhost/api/screenshots');
      url2.searchParams.set('workspaceId', testWorkspace.id);
      url2.searchParams.set('limit', '1');
      url2.searchParams.set('cursor', data1.pagination.nextCursor);
      const request2 = new Request(url2.toString());

      const response2 = await GET(request2);
      const data2 = await response2.json();

      expect(response2.status).toBe(200);
      expect(data2.screenshots).toHaveLength(1);
      expect(data2.screenshots[0].id).not.toBe(data1.screenshots[0].id);
    });

    it('should order screenshots by createdAt descending (newest first)', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create 3 screenshots with delays
      const screenshots = [];
      for (let i = 0; i < 3; i++) {
        screenshots.push(
          await createTestScreenshot({
            workspaceId: testWorkspace.id,
            taskId: testTask.id,
          })
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.screenshots.length).toBeGreaterThanOrEqual(3);

      // Verify ordering (newest first)
      for (let i = 0; i < data.screenshots.length - 1; i++) {
        const current = new Date(data.screenshots[i].createdAt);
        const next = new Date(data.screenshots[i + 1].createdAt);
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
      }
    });
  });

  describe('Filtering', () => {
    it('should filter screenshots by workspaceId', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create screenshot in test workspace
      const testScreenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: testTask.id,
      });

      // Create screenshots in another workspace (not queried)
      mockAuthenticatedSession(anotherUser.id);
      const anotherScreenshot = await createTestScreenshot({
        workspaceId: anotherWorkspace.id,
      });

      // Query test workspace
      mockAuthenticatedSession(testUser.id);
      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Should only return the screenshot from testWorkspace
      expect(data.screenshots.length).toBeGreaterThan(0);
      expect(data.screenshots.some((s: any) => s.id === testScreenshot.id)).toBe(true);
      // Should not return screenshots from another workspace
      expect(data.screenshots.some((s: any) => s.id === anotherScreenshot.id)).toBe(false);
    });

    it('should filter screenshots by workspaceId and taskId', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create another task
      const anotherTask = await createTestTask({
        title: 'Another Task',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });
      createdTaskIds.push(anotherTask.id);

      // Create screenshots for different tasks
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: testTask.id,
      });
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: anotherTask.id,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('taskId', testTask.id);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.screenshots.every((s: any) => s.taskId === testTask.id)).toBe(true);
    });

    it('should filter screenshots by workspaceId and pageUrl', async () => {
      mockAuthenticatedSession(testUser.id);

      const pageUrl1 = 'https://example.com/page1';
      const pageUrl2 = 'https://example.com/page2';

      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        pageUrl: pageUrl1,
      });
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        pageUrl: pageUrl2,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('pageUrl', pageUrl1);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.screenshots.every((s: any) => s.pageUrl === pageUrl1)).toBe(true);
    });

    it('should filter by all parameters combined', async () => {
      mockAuthenticatedSession(testUser.id);

      const pageUrl = 'https://example.com/specific-page';

      const matchingScreenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: testTask.id,
        pageUrl,
      });
      const nonMatchingScreenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: testTask.id,
        pageUrl: 'https://example.com/other-page',
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('taskId', testTask.id);
      url.searchParams.set('pageUrl', pageUrl);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Verify filtering works: should only return screenshots matching all criteria
      expect(data.screenshots.every((s: any) => s.taskId === testTask.id && s.pageUrl === pageUrl)).toBe(true);
      expect(data.screenshots.some((s: any) => s.id === matchingScreenshot.id)).toBe(true);
      expect(data.screenshots.some((s: any) => s.id === nonMatchingScreenshot.id)).toBe(false);
    });

    it('should return empty array when no screenshots match filters', async () => {
      mockAuthenticatedSession(testUser.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('pageUrl', 'https://non-existent-page.com');
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.screenshots).toEqual([]);
      expect(data.pagination.hasMore).toBe(false);
      expect(data.pagination.nextCursor).toBeNull();
    });
  });

  describe('URL Expiration', () => {
    it('should regenerate expired presigned URLs', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create screenshot with expired URL
      const expiredDate = new Date(Date.now() - 1000); // 1 second ago
      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        s3Url: 'https://old-expired-url.s3.amazonaws.com/test.png',
        urlExpiresAt: expiredDate,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        screenshot.s3Key,
        7 * 24 * 60 * 60
      );

      // Verify new URL in response
      const returnedScreenshot = data.screenshots.find((s: any) => s.id === screenshot.id);
      expect(returnedScreenshot.s3Url).toBe('https://new-presigned-url.s3.amazonaws.com/test.png');

      // Verify database was updated
      const updatedScreenshot = await db.screenshot.findUnique({
        where: { id: screenshot.id },
      });
      expect(updatedScreenshot?.s3Url).toBe('https://new-presigned-url.s3.amazonaws.com/test.png');
      expect(updatedScreenshot?.urlExpiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should keep valid URLs unchanged', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create screenshot with valid URL (expires in 1 day)
      const futureDate = new Date(Date.now() + 86400000);
      const validUrl = 'https://valid-url.s3.amazonaws.com/test.png';
      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        s3Url: validUrl,
        urlExpiresAt: futureDate,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);

      // Verify S3 service was NOT called for valid URL
      expect(mockS3Service.generatePresignedDownloadUrl).not.toHaveBeenCalled();

      // Verify URL remained unchanged
      const returnedScreenshot = data.screenshots.find((s: any) => s.id === screenshot.id);
      expect(returnedScreenshot.s3Url).toBe(validUrl);
    });

    it('should update urlExpiresAt in database when regenerating', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create screenshot with expired URL
      const expiredDate = new Date(Date.now() - 10000);
      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        s3Url: 'https://old-url.s3.amazonaws.com/test.png',
        urlExpiresAt: expiredDate,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const beforeUpdate = Date.now();
      await GET(request);
      const afterUpdate = Date.now();

      // Verify database urlExpiresAt was updated
      const updatedScreenshot = await db.screenshot.findUnique({
        where: { id: screenshot.id },
      });

      const expectedExpiration = beforeUpdate + 7 * 24 * 60 * 60 * 1000; // 7 days
      const actualExpiration = updatedScreenshot!.urlExpiresAt.getTime();

      // Allow 10 second tolerance for test execution time
      expect(actualExpiration).toBeGreaterThan(beforeUpdate);
      expect(actualExpiration).toBeLessThanOrEqual(afterUpdate + 7 * 24 * 60 * 60 * 1000 + 10000);
    });

    it('should handle multiple expired URLs in batch', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create 3 screenshots with expired URLs
      const expiredDate = new Date(Date.now() - 1000);
      const screenshots = [];
      for (let i = 0; i < 3; i++) {
        screenshots.push(
          await createTestScreenshot({
            workspaceId: testWorkspace.id,
            s3Url: `https://old-url-${i}.s3.amazonaws.com/test.png`,
            urlExpiresAt: expiredDate,
          })
        );
      }

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);

      // Verify all URLs were regenerated
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledTimes(3);

      // Verify all returned screenshots have new URLs
      const returnedScreenshots = data.screenshots.filter((s: any) =>
        screenshots.some((ss) => ss.id === s.id)
      );
      expect(returnedScreenshots.every((s: any) => s.s3Url.includes('new-presigned-url'))).toBe(true);
    });
  });

  describe('Response Format', () => {
    it('should return correct screenshot fields', async () => {
      mockAuthenticatedSession(testUser.id);

      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: testTask.id,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);

      const returnedScreenshot = data.screenshots.find((s: any) => s.id === screenshot.id);
      expect(returnedScreenshot).toBeDefined();
      expect(returnedScreenshot).toHaveProperty('id');
      expect(returnedScreenshot).toHaveProperty('s3Key');
      expect(returnedScreenshot).toHaveProperty('s3Url');
      expect(returnedScreenshot).toHaveProperty('urlExpiresAt');
      expect(returnedScreenshot).toHaveProperty('actionIndex');
      expect(returnedScreenshot).toHaveProperty('pageUrl');
      expect(returnedScreenshot).toHaveProperty('timestamp');
      expect(returnedScreenshot).toHaveProperty('hash');
      expect(returnedScreenshot).toHaveProperty('width');
      expect(returnedScreenshot).toHaveProperty('height');
      expect(returnedScreenshot).toHaveProperty('taskId');
      expect(returnedScreenshot).toHaveProperty('createdAt');
      expect(returnedScreenshot).toHaveProperty('updatedAt');
    });

    it('should serialize BigInt timestamps correctly', async () => {
      mockAuthenticatedSession(testUser.id);

      await createTestScreenshot({
        workspaceId: testWorkspace.id,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.screenshots.length).toBeGreaterThan(0);

      // Verify timestamp is a number (not BigInt string)
      const screenshot = data.screenshots[0];
      expect(typeof screenshot.timestamp).toBe('number');
      expect(Number.isInteger(screenshot.timestamp)).toBe(true);
    });

    it('should include pagination metadata', async () => {
      mockAuthenticatedSession(testUser.id);

      await createTestScreenshot({
        workspaceId: testWorkspace.id,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '10');
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('hasMore');
      expect(data.pagination).toHaveProperty('nextCursor');
      expect(data.pagination).toHaveProperty('limit');
      expect(typeof data.pagination.hasMore).toBe('boolean');
      expect(data.pagination.limit).toBe(10);
    });

    it('should return valid presigned URLs', async () => {
      mockAuthenticatedSession(testUser.id);

      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        s3Url: 'https://test-bucket.s3.amazonaws.com/test.png',
        urlExpiresAt: new Date(Date.now() + 86400000),
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);

      const returnedScreenshot = data.screenshots.find((s: any) => s.id === screenshot.id);
      expect(returnedScreenshot.s3Url).toMatch(/^https:\/\/.+\.s3\.amazonaws\.com\/.+/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty screenshot list', async () => {
      mockAuthenticatedSession(testUser.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.screenshots).toEqual([]);
      expect(data.pagination.hasMore).toBe(false);
      expect(data.pagination.nextCursor).toBeNull();
    });

    it('should handle workspace with no screenshots', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create a new workspace with no screenshots
      const emptyWorkspace = await db.workspace.create({
        data: {
          name: 'Empty Workspace',
          slug: `empty-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          ownerId: testUser.id,
        },
      });
      createdWorkspaceIds.push(emptyWorkspace.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', emptyWorkspace.id);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.screenshots).toEqual([]);
      expect(data.pagination.hasMore).toBe(false);
    });

    it('should handle large result sets', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create 100 screenshots
      const createPromises = [];
      for (let i = 0; i < 100; i++) {
        createPromises.push(
          createTestScreenshot({
            workspaceId: testWorkspace.id,
          })
        );
      }
      await Promise.all(createPromises);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '50');
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.screenshots).toHaveLength(50);
      expect(data.pagination.hasMore).toBe(true);
      expect(data.pagination.nextCursor).toBeDefined();
    });

    it('should handle cursor at end of results', async () => {
      mockAuthenticatedSession(testUser.id);

      // Create 2 screenshots
      const screenshots = [];
      for (let i = 0; i < 2; i++) {
        screenshots.push(
          await createTestScreenshot({
            workspaceId: testWorkspace.id,
          })
        );
      }

      // Sort by createdAt to get the oldest screenshot
      const sortedScreenshots = screenshots.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );
      const lastScreenshotId = sortedScreenshots[0].id;

      // Use last screenshot ID as cursor
      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('cursor', lastScreenshotId);
      const request = new Request(url.toString());

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.screenshots).toEqual([]);
      expect(data.pagination.hasMore).toBe(false);
      expect(data.pagination.nextCursor).toBeNull();
    });
  });
});
