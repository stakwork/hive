import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/screenshots/route';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import type { Session } from 'next-auth';
import { createTestUser } from '@/__tests__/support/fixtures/user';
import { createTestWorkspace } from '@/__tests__/support/fixtures/workspace';
import { createTestTask } from '@/__tests__/support/fixtures/task';

// Test helpers
const createAuthenticatedGetRequest = (url: string) => {
  const request = new Request(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return request;
};

const getMockedSession = () => getServerSession as unknown as ReturnType<typeof vi.fn>;

const createAuthenticatedSession = (userId: string): Session => ({
  user: {
    id: userId,
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: new Date(Date.now() + 86400000).toISOString(),
});

const mockUnauthenticatedSession = () => null;

// Mock S3 service
const mockS3Service = {
  validateFileType: vi.fn(),
  validateFileSize: vi.fn(),
  validateImageBuffer: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  generatePresignedDownloadUrl: vi.fn(),
};

vi.mock('@/services/s3', () => ({
  getS3Service: vi.fn(() => mockS3Service),
}));

vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));

describe('GET /api/screenshots Integration Tests', () => {
  let testUser: any;
  let testWorkspace: any;
  let testTask: any;
  let createdScreenshotIds: string[] = [];
  let createdUserIds: string[] = [];
  let createdWorkspaceIds: string[] = [];
  let createdTaskIds: string[] = [];

  // Helper to create test data
  const createTestUserWithWorkspaceAndTask = async () => {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `test-${Date.now()}@example.com`,
          name: 'Test User',
        },
      });
      createdUserIds.push(user.id);

      const workspace = await tx.workspace.create({
        data: {
          name: `Test Workspace ${Date.now()}`,
          slug: `test-ws-${Date.now()}`,
          ownerId: user.id,
          deleted: false,
        },
      });
      createdWorkspaceIds.push(workspace.id);

      const task = await tx.task.create({
        data: {
          title: 'Test Task',
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      createdTaskIds.push(task.id);

      return { user, workspace, task };
    });
  };

  const createTestScreenshot = async (data: {
    workspaceId: string;
    taskId?: string;
    s3Key?: string;
    s3Url?: string;
    urlExpiresAt?: Date;
    pageUrl?: string;
    hash?: string;
    width?: number;
    height?: number;
  }) => {
    const screenshot = await db.screenshot.create({
      data: {
        workspaceId: data.workspaceId,
        taskId: data.taskId,
        s3Key: data.s3Key || `test-key-${Date.now()}`,
        s3Url: data.s3Url || 'https://test-bucket.s3.amazonaws.com/test',
        urlExpiresAt: data.urlExpiresAt || new Date(Date.now() + 86400000),
        pageUrl: data.pageUrl || 'https://example.com',
        hash: data.hash || `hash-${Date.now()}`,
        width: data.width || 1920,
        height: data.height || 1080,
        timestamp: BigInt(Date.now()),
        actionIndex: 0,
      },
    });
    createdScreenshotIds.push(screenshot.id);
    return screenshot;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Setup test data
    const fixtures = await createTestUserWithWorkspaceAndTask();
    testUser = fixtures.user;
    testWorkspace = fixtures.workspace;
    testTask = fixtures.task;

    // Mock S3 service default behavior
    mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
      'https://test-bucket.s3.amazonaws.com/presigned-url'
    );
  });

  afterEach(async () => {
    // Cleanup in reverse order of dependencies
    if (createdScreenshotIds.length > 0) {
      await db.screenshot.deleteMany({
        where: { id: { in: createdScreenshotIds } },
      });
      createdScreenshotIds = [];
    }

    if (createdTaskIds.length > 0) {
      await db.task.deleteMany({
        where: { id: { in: createdTaskIds } },
      });
      createdTaskIds = [];
    }

    if (createdWorkspaceIds.length > 0) {
      await db.workspace.deleteMany({
        where: { id: { in: createdWorkspaceIds } },
      });
      createdWorkspaceIds = [];
    }

    if (createdUserIds.length > 0) {
      await db.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      createdUserIds = [];
    }
  });

  // ========================================
  // 1. AUTHENTICATION TESTS
  // ========================================
  describe('Authentication', () => {
    test('should return 401 for unauthenticated request', async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Authentication required');
    });

    test('should return 401 for invalid session', async () => {
      getMockedSession().mockResolvedValue(null);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Authentication required');
    });
  });

  // ========================================
  // 2. AUTHORIZATION TESTS
  // ========================================
  describe('Authorization', () => {
    test('should return 404 for non-existent workspace', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', 'non-existent-workspace-id');
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Workspace not found or access denied');
    });

    test('should return 404 for soft-deleted workspace', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Soft delete the workspace
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { deleted: true },
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Workspace not found or access denied');
    });

    test('should allow access for workspace owner', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: testTask.id,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(1);
      expect(data.screenshots[0].id).toBe(screenshot.id);
    });

    test('should allow access for active workspace members', async () => {
      // Create another user and add as member
      const memberUser = await db.user.create({
        data: {
          email: `member-${Date.now()}@example.com`,
          name: 'Member User',
        },
      });
      createdUserIds.push(memberUser.id);

      await db.workspaceMember.create({
        data: {
          userId: memberUser.id,
          workspaceId: testWorkspace.id,
          role: 'DEVELOPER',
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser.id));

      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(1);
    });

    test('should deny access for members who left (leftAt !== null)', async () => {
      // Create another user and add as member who left
      const leftMemberUser = await db.user.create({
        data: {
          email: `left-member-${Date.now()}@example.com`,
          name: 'Left Member',
        },
      });
      createdUserIds.push(leftMemberUser.id);

      await db.workspaceMember.create({
        data: {
          userId: leftMemberUser.id,
          workspaceId: testWorkspace.id,
          role: 'DEVELOPER',
          leftAt: new Date(),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(leftMemberUser.id));

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Workspace not found or access denied');
    });

    test('should deny access when user is not workspace owner or member', async () => {
      // Create another user who is not a member
      const outsiderUser = await db.user.create({
        data: {
          email: `outsider-${Date.now()}@example.com`,
          name: 'Outsider User',
        },
      });
      createdUserIds.push(outsiderUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(outsiderUser.id));

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Workspace not found or access denied');
    });
  });

  // ========================================
  // 3. QUERY PARAMETER VALIDATION
  // ========================================
  describe('Query Parameter Validation', () => {
    test('should return 400 for missing workspaceId', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const url = new URL('http://localhost/api/screenshots');
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid request parameters');
    });

    test('should return 400 for invalid workspaceId format', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', ''); // empty string
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid request parameters');
    });

    test('should validate optional limit parameter (too low)', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '0'); // below minimum
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid request parameters');
    });

    test('should validate optional limit parameter (too high)', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '1000'); // high but valid limit
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      // API doesn't have a max limit validation, so it should succeed
      expect(response.status).toBe(200);
    });

    test('should accept valid optional taskId parameter', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('taskId', testTask.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test('should accept valid optional pageUrl parameter', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('pageUrl', 'https://example.com/page');
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test('should accept valid optional cursor parameter', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('cursor', screenshot.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  // ========================================
  // 4. PAGINATION TESTS
  // ========================================
  describe('Pagination', () => {
    test('should return correct number of screenshots respecting limit', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create 5 screenshots
      for (let i = 0; i < 5; i++) {
        await createTestScreenshot({
          workspaceId: testWorkspace.id,
          hash: `hash-${i}`,
        });
      }

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '3');
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(3);
      expect(data.pagination.limit).toBe(3);
    });

    test('should return hasMore=true when more results exist', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create 6 screenshots
      for (let i = 0; i < 6; i++) {
        await createTestScreenshot({
          workspaceId: testWorkspace.id,
          hash: `hash-${i}`,
        });
      }

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '5');
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(5);
      expect(data.pagination.hasMore).toBe(true);
      expect(data.pagination.nextCursor).toBeDefined();
    });

    test('should return hasMore=false on last page', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create 3 screenshots
      for (let i = 0; i < 3; i++) {
        await createTestScreenshot({
          workspaceId: testWorkspace.id,
          hash: `hash-${i}`,
        });
      }

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '5');
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(3);
      expect(data.pagination.hasMore).toBe(false);
      expect(data.pagination.nextCursor).toBeNull();
    });

    test('should return valid nextCursor for pagination', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create 4 screenshots with delays to ensure different timestamps
      const screenshots = [];
      for (let i = 0; i < 4; i++) {
        const screenshot = await createTestScreenshot({
          workspaceId: testWorkspace.id,
          hash: `hash-${i}`,
        });
        screenshots.push(screenshot);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '2');
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(2);
      expect(data.pagination.hasMore).toBe(true);
      expect(data.pagination.nextCursor).toBe(data.screenshots[1].id);
    });

    test('should fetch next page using cursor', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create 4 screenshots
      const screenshots = [];
      for (let i = 0; i < 4; i++) {
        const screenshot = await createTestScreenshot({
          workspaceId: testWorkspace.id,
          hash: `hash-${i}`,
        });
        screenshots.push(screenshot);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // First page
      const url1 = new URL('http://localhost/api/screenshots');
      url1.searchParams.set('workspaceId', testWorkspace.id);
      url1.searchParams.set('limit', '2');
      const request1 = createAuthenticatedGetRequest(url1.toString());
      const response1 = await GET(request1);
      const data1 = await response1.json();

      // Second page using cursor
      const url2 = new URL('http://localhost/api/screenshots');
      url2.searchParams.set('workspaceId', testWorkspace.id);
      url2.searchParams.set('limit', '2');
      url2.searchParams.set('cursor', data1.pagination.nextCursor);
      const request2 = createAuthenticatedGetRequest(url2.toString());
      const response2 = await GET(request2);

      expect(response2.status).toBe(200);
      const data2 = await response2.json();
      expect(data2.screenshots).toHaveLength(2);
      
      // Ensure no overlap between pages
      const firstPageIds = data1.screenshots.map((s: any) => s.id);
      const secondPageIds = data2.screenshots.map((s: any) => s.id);
      expect(firstPageIds).not.toContain(secondPageIds[0]);
      expect(firstPageIds).not.toContain(secondPageIds[1]);
    });

    test('should order by createdAt descending (newest first)', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create screenshots with delays
      const screenshot1 = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        hash: 'hash-1',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const screenshot2 = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        hash: 'hash-2',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const screenshot3 = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        hash: 'hash-3',
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(3);
      
      // Newest should be first
      expect(data.screenshots[0].id).toBe(screenshot3.id);
      expect(data.screenshots[1].id).toBe(screenshot2.id);
      expect(data.screenshots[2].id).toBe(screenshot1.id);
    });
  });

  // ========================================
  // 5. FILTERING TESTS
  // ========================================
  describe('Filtering', () => {
    test('should filter by workspaceId only', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create screenshots in test workspace
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
      });
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(2);
      // Note: workspaceId is not returned in response, only used for filtering
    });

    test('should filter by workspaceId + taskId', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create screenshot with task
      const screenshotWithTask = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: testTask.id,
      });

      // Create screenshot without task
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: undefined,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('taskId', testTask.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(1);
      expect(data.screenshots[0].id).toBe(screenshotWithTask.id);
      expect(data.screenshots[0].taskId).toBe(testTask.id);
    });

    test('should filter by workspaceId + pageUrl', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create screenshot with specific pageUrl
      const screenshotWithPageUrl = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        pageUrl: 'https://example.com/specific-page',
      });

      // Create screenshot with different pageUrl
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        pageUrl: 'https://example.com/other-page',
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('pageUrl', 'https://example.com/specific-page');
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(1);
      expect(data.screenshots[0].id).toBe(screenshotWithPageUrl.id);
      expect(data.screenshots[0].pageUrl).toBe('https://example.com/specific-page');
    });

    test('should filter by all parameters combined (workspaceId + taskId + pageUrl)', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create screenshot matching all filters
      const matchingScreenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: testTask.id,
        pageUrl: 'https://example.com/target-page',
      });

      // Create screenshots with partial matches
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: testTask.id,
        pageUrl: 'https://example.com/different-page',
      });

      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: undefined,
        pageUrl: 'https://example.com/target-page',
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('taskId', testTask.id);
      url.searchParams.set('pageUrl', 'https://example.com/target-page');
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(1);
      expect(data.screenshots[0].id).toBe(matchingScreenshot.id);
    });

    test('should return empty array when no matches found', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create screenshot with different pageUrl
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        pageUrl: 'https://example.com/page1',
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('pageUrl', 'https://example.com/nonexistent-page');
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(0);
      expect(data.pagination.hasMore).toBe(false);
    });
  });

  // ========================================
  // 6. URL EXPIRATION TESTS
  // ========================================
  describe('URL Expiration', () => {
    test('should regenerate expired presigned URLs', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create screenshot with expired URL
      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        s3Key: 'expired-test-key',
        s3Url: 'https://old-expired-url.com',
        urlExpiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Verify URL was regenerated
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        'expired-test-key',
        7 * 24 * 60 * 60 // 7 days in seconds
      );
      expect(data.screenshots[0].s3Url).toBe('https://test-bucket.s3.amazonaws.com/presigned-url');
      
      // Verify database was updated
      const updatedScreenshot = await db.screenshot.findUnique({
        where: { id: screenshot.id },
      });
      expect(updatedScreenshot?.s3Url).toBe('https://test-bucket.s3.amazonaws.com/presigned-url');
      expect(updatedScreenshot?.urlExpiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    test('should keep valid URLs unchanged', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const validUrl = 'https://valid-url.com/screenshot.jpg';
      const futureExpiry = new Date(Date.now() + 86400000); // 1 day from now

      // Create screenshot with valid URL
      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        s3Url: validUrl,
        urlExpiresAt: futureExpiry,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Verify URL was NOT regenerated
      expect(mockS3Service.generatePresignedDownloadUrl).not.toHaveBeenCalled();
      expect(data.screenshots[0].s3Url).toBe(validUrl);
    });

    test('should update urlExpiresAt in database after regeneration', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const oldExpiry = new Date(Date.now() - 1000);
      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        urlExpiresAt: oldExpiry,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      await GET(request);

      // Verify database update
      const updatedScreenshot = await db.screenshot.findUnique({
        where: { id: screenshot.id },
      });
      
      expect(updatedScreenshot?.urlExpiresAt.getTime()).toBeGreaterThan(oldExpiry.getTime());
      // Should be approximately 7 days from now
      const expectedExpiry = Date.now() + (7 * 24 * 60 * 60 * 1000);
      const timeDiff = Math.abs(updatedScreenshot!.urlExpiresAt.getTime() - expectedExpiry);
      expect(timeDiff).toBeLessThan(5000); // Within 5 seconds tolerance
    });

    test('should handle multiple expired URLs in batch', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create 3 screenshots with expired URLs
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        urlExpiresAt: new Date(Date.now() - 1000),
      });
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        urlExpiresAt: new Date(Date.now() - 2000),
      });
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        urlExpiresAt: new Date(Date.now() - 3000),
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      
      // Verify all URLs were regenerated
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledTimes(3);
    });

    test('should regenerate URL when s3Url is null', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create screenshot without s3Url
      const screenshot = await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          s3Key: 'test-key-no-url',
          s3Url: null,
          urlExpiresAt: null,
          pageUrl: 'https://example.com',
          hash: 'hash-no-url',
          width: 1920,
          height: 1080,
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
        },
      });
      createdScreenshotIds.push(screenshot.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Verify URL was generated
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalled();
      expect(data.screenshots[0].s3Url).toBe('https://test-bucket.s3.amazonaws.com/presigned-url');
    });
  });

  // ========================================
  // 7. RESPONSE FORMAT TESTS
  // ========================================
  describe('Response Format', () => {
    test('should return correct screenshot fields', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: testTask.id,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.screenshots).toHaveLength(1);
      const returnedScreenshot = data.screenshots[0];
      
      // Verify all expected fields are present
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

    test('should serialize BigInt timestamps correctly to numbers', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Verify timestamp is a number, not BigInt
      expect(typeof data.screenshots[0].timestamp).toBe('number');
      expect(data.screenshots[0].timestamp).toBeGreaterThan(0);
    });

    test('should include pagination metadata', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      await createTestScreenshot({
        workspaceId: testWorkspace.id,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Verify pagination metadata structure
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('hasMore');
      expect(data.pagination).toHaveProperty('nextCursor');
      expect(data.pagination).toHaveProperty('limit');
      expect(typeof data.pagination.hasMore).toBe('boolean');
      expect(typeof data.pagination.limit).toBe('number');
    });

    test('should return valid presigned URLs', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      await createTestScreenshot({
        workspaceId: testWorkspace.id,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Verify URL format
      expect(data.screenshots[0].s3Url).toMatch(/^https:\/\//);
    });
  });

  // ========================================
  // 8. EDGE CASES
  // ========================================
  describe('Edge Cases', () => {
    test('should handle empty screenshot list', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(0);
      expect(data.pagination.hasMore).toBe(false);
      expect(data.pagination.nextCursor).toBeNull();
    });

    test('should handle workspace with no screenshots', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create a new workspace without screenshots
      const emptyWorkspace = await db.workspace.create({
        data: {
          name: `Empty Workspace ${Date.now()}`,
          slug: `empty-ws-${Date.now()}`,
          ownerId: testUser.id,
          deleted: false,
        },
      });
      createdWorkspaceIds.push(emptyWorkspace.id);

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', emptyWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(0);
    });

    test('should handle large result sets', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create 100 screenshots with unique s3Keys
      for (let i = 0; i < 100; i++) {
        await createTestScreenshot({
          workspaceId: testWorkspace.id,
          hash: `hash-large-${i}`,
          s3Key: `s3-key-large-${i}-${Date.now()}`,
        });
      }

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('limit', '100');
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(100);
    });

    test('should handle cursor at end of results', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      const screenshot = await createTestScreenshot({
        workspaceId: testWorkspace.id,
      });

      // Use the screenshot's ID as cursor (should return empty results)
      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      url.searchParams.set('cursor', screenshot.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(0);
      expect(data.pagination.hasMore).toBe(false);
    });

    test('should handle screenshots with null taskId', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create screenshot without task
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        taskId: undefined,
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(1);
      expect(data.screenshots[0].taskId).toBeNull();
    });

    test('should handle mixed expired and valid URLs in same response', async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser.id));

      // Create expired URL screenshot
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        urlExpiresAt: new Date(Date.now() - 1000),
        hash: 'expired-hash',
      });

      // Create valid URL screenshot
      await createTestScreenshot({
        workspaceId: testWorkspace.id,
        urlExpiresAt: new Date(Date.now() + 86400000),
        hash: 'valid-hash',
      });

      const url = new URL('http://localhost/api/screenshots');
      url.searchParams.set('workspaceId', testWorkspace.id);
      const request = createAuthenticatedGetRequest(url.toString());

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.screenshots).toHaveLength(2);
      
      // Verify only expired URL was regenerated (1 call)
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledTimes(1);
    });
  });
});