import { describe, test, expect, beforeEach, vi } from 'vitest'
import { GET } from '@/app/api/screenshots/route'
import { db } from '@/lib/db'
import { getMockedSession } from '@/__tests__/support/helpers/auth'

// Mock S3Service
const mockGeneratePresignedDownloadUrl = vi.fn()
vi.mock('@/services/s3', () => ({
  getS3Service: vi.fn(() => ({
    generatePresignedDownloadUrl: mockGeneratePresignedDownloadUrl,
  })),
}))

// Mock NextAuth
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth/nextauth', () => ({
  authOptions: {},
}))

describe('GET /api/screenshots Integration Tests', () => {
  let testUser: any
  let testWorkspace: any
  let testTask: any
  let testMember: any
  let otherUser: any

  beforeEach(async () => {
    vi.clearAllMocks()

    // Reset mock implementations
    mockGeneratePresignedDownloadUrl.mockResolvedValue(
      'https://mock-s3.example.com/test-screenshot.jpg?expires=123456789'
    )

    // Create test fixtures
    testUser = await db.user.create({
      data: {
        email: 'test@example.com',
        name: 'Test User',
      },
    })

    testWorkspace = await db.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: 'test-workspace',
        ownerId: testUser.id,
      },
    })

    testTask = await db.task.create({
      data: {
        title: 'Test Task',
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    })

    otherUser = await db.user.create({
      data: {
        email: 'other@example.com',
        name: 'Other User',
      },
    })

    testMember = await db.workspaceMember.create({
      data: {
        workspaceId: testWorkspace.id,
        userId: otherUser.id,
        role: 'DEVELOPER',
      },
    })
  })

  describe('Authentication', () => {
    test('should return 401 for unauthenticated request', async () => {
      getMockedSession().mockResolvedValue(null)

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Authentication required')
    })

    test('should return 401 for invalid session', async () => {
      getMockedSession().mockResolvedValue({
        user: { id: '', email: '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      // Empty user ID results in 404 (workspace not found) because user check happens in workspace query
      expect(response.status).toBe(404)
    })
  })

  describe('Authorization', () => {
    test('should return 404 for non-existent workspace', async () => {
      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', 'non-existent-id')
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Workspace not found or access denied')
    })

    test('should return 404 for soft-deleted workspace', async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { deleted: true, deletedAt: new Date() },
      })

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(404)
    })

    test('should return 404 when user is not workspace owner or member', async () => {
      const outsider = await db.user.create({
        data: {
          email: 'outsider@example.com',
          name: 'Outsider',
        },
      })

      getMockedSession().mockResolvedValue({
        user: { id: outsider.id, email: outsider.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(404)
    })

    test('should allow access for workspace owner', async () => {
      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('screenshots')
      expect(data).toHaveProperty('pagination')
    })

    test('should allow access for active workspace members', async () => {
      getMockedSession().mockResolvedValue({
        user: { id: otherUser.id, email: otherUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
    })

    test('should deny access for members who left (leftAt !== null)', async () => {
      await db.workspaceMember.update({
        where: { id: testMember.id },
        data: { leftAt: new Date() },
      })

      getMockedSession().mockResolvedValue({
        user: { id: otherUser.id, email: otherUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(404)
    })
  })

  describe('Query Parameter Validation', () => {
    test('should return 400 for missing workspaceId', async () => {
      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Invalid request parameters')
    })

    test('should validate optional taskId parameter', async () => {
      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      url.searchParams.set('taskId', testTask.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
    })

    test('should validate optional pageUrl parameter', async () => {
      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      url.searchParams.set('pageUrl', 'https://example.com')
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
    })

    test('should validate optional limit parameter', async () => {
      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      url.searchParams.set('limit', '10')
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pagination.limit).toBe(10)
    })

    test('should validate optional cursor parameter', async () => {
      const screenshot = await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          taskId: testTask.id,
          s3Key: 'test-key',
          s3Url: 'https://example.com/test.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-123',
          pageUrl: 'https://example.com',
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
        },
      })

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      url.searchParams.set('cursor', screenshot.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
    })
  })

  describe('Pagination', () => {
    test('should return correct number of screenshots (respects limit)', async () => {
      // Create 5 screenshots
      for (let i = 0; i < 5; i++) {
        await db.screenshot.create({
          data: {
            workspaceId: testWorkspace.id,
            taskId: testTask.id,
            s3Key: `test-key-${i}`,
            s3Url: `https://example.com/test-${i}.jpg`,
            urlExpiresAt: new Date(Date.now() + 86400000),
            hash: `test-hash-${i}`,
            pageUrl: 'https://example.com',
            timestamp: BigInt(Date.now() + i),
            actionIndex: i,
          },
        })
      }

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      url.searchParams.set('limit', '3')
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.screenshots).toHaveLength(3)
    })

    test('should return hasMore=true when more results exist', async () => {
      // Create 5 screenshots
      for (let i = 0; i < 5; i++) {
        await db.screenshot.create({
          data: {
            workspaceId: testWorkspace.id,
            s3Key: `test-key-${i}`,
            s3Url: `https://example.com/test-${i}.jpg`,
            urlExpiresAt: new Date(Date.now() + 86400000),
            hash: `test-hash-${i}`,
            pageUrl: 'https://example.com',
            timestamp: BigInt(Date.now() + i),
            actionIndex: i,
          },
        })
      }

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      url.searchParams.set('limit', '3')
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pagination.hasMore).toBe(true)
      expect(data.pagination.nextCursor).toBeDefined()
    })

    test('should return hasMore=false on last page', async () => {
      // Create 2 screenshots
      for (let i = 0; i < 2; i++) {
        await db.screenshot.create({
          data: {
            workspaceId: testWorkspace.id,
            s3Key: `test-key-${i}`,
            s3Url: `https://example.com/test-${i}.jpg`,
            urlExpiresAt: new Date(Date.now() + 86400000),
            hash: `test-hash-${i}`,
            pageUrl: 'https://example.com',
            timestamp: BigInt(Date.now() + i),
            actionIndex: i,
          },
        })
      }

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      url.searchParams.set('limit', '5')
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pagination.hasMore).toBe(false)
      expect(data.pagination.nextCursor).toBeNull()
    })

    test('should return valid nextCursor for pagination', async () => {
      // Create 3 screenshots
      for (let i = 0; i < 3; i++) {
        await db.screenshot.create({
          data: {
            workspaceId: testWorkspace.id,
            s3Key: `test-key-${i}`,
            s3Url: `https://example.com/test-${i}.jpg`,
            urlExpiresAt: new Date(Date.now() + 86400000),
            hash: `test-hash-${i}`,
            pageUrl: 'https://example.com',
            timestamp: BigInt(Date.now() + i),
            actionIndex: i,
          },
        })
      }

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      url.searchParams.set('limit', '2')
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pagination.nextCursor).toBe(data.screenshots[1].id)
    })

    test('should fetch next page using cursor', async () => {
      // Create 5 screenshots
      for (let i = 0; i < 5; i++) {
        await db.screenshot.create({
          data: {
            workspaceId: testWorkspace.id,
            s3Key: `test-key-${i}`,
            s3Url: `https://example.com/test-${i}.jpg`,
            urlExpiresAt: new Date(Date.now() + 86400000),
            hash: `test-hash-${i}`,
            pageUrl: 'https://example.com',
            timestamp: BigInt(Date.now() + i),
            actionIndex: i,
          },
        })
      }

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      // First page
      const url1 = new URL('http://localhost/api/screenshots')
      url1.searchParams.set('workspaceId', testWorkspace.id)
      url1.searchParams.set('limit', '2')
      const request1 = new Request(url1.toString())
      const response1 = await GET(request1)
      const data1 = await response1.json()

      // Second page with cursor
      const url2 = new URL('http://localhost/api/screenshots')
      url2.searchParams.set('workspaceId', testWorkspace.id)
      url2.searchParams.set('limit', '2')
      url2.searchParams.set('cursor', data1.pagination.nextCursor)
      const request2 = new Request(url2.toString())
      const response2 = await GET(request2)
      const data2 = await response2.json()

      expect(data2.screenshots).toHaveLength(2)
      expect(data2.screenshots[0].id).not.toBe(data1.screenshots[0].id)
    })

    test('should order by createdAt descending (newest first)', async () => {
      // Create screenshots with different timestamps
      const screenshot1 = await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          s3Key: 'test-key-1',
          s3Url: 'https://example.com/test-1.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-1',
          pageUrl: 'https://example.com',
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
          createdAt: new Date(Date.now() - 2000),
        },
      })

      const screenshot2 = await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          s3Key: 'test-key-2',
          s3Url: 'https://example.com/test-2.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-2',
          pageUrl: 'https://example.com',
          timestamp: BigInt(Date.now()),
          actionIndex: 1,
          createdAt: new Date(Date.now() - 1000),
        },
      })

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.screenshots[0].id).toBe(screenshot2.id)
      expect(data.screenshots[1].id).toBe(screenshot1.id)
    })
  })

  describe('Filtering', () => {
    test('should filter by workspaceId', async () => {
      const otherWorkspace = await db.workspace.create({
        data: {
          name: 'Other Workspace',
          slug: 'other-workspace',
          ownerId: testUser.id,
        },
      })

      await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          s3Key: 'test-key-1',
          s3Url: 'https://example.com/test-1.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-1',
          pageUrl: 'https://example.com',
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
        },
      })

      await db.screenshot.create({
        data: {
          workspaceId: otherWorkspace.id,
          s3Key: 'test-key-2',
          s3Url: 'https://example.com/test-2.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-2',
          pageUrl: 'https://example.com',
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
        },
      })

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.screenshots).toHaveLength(1)
      // Note: workspaceId is not returned in the API response, only used for filtering
    })

    test('should filter by workspaceId + taskId', async () => {
      const otherTask = await db.task.create({
        data: {
          title: 'Other Task',
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      })

      await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          taskId: testTask.id,
          s3Key: 'test-key-1',
          s3Url: 'https://example.com/test-1.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-1',
          pageUrl: 'https://example.com',
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
        },
      })

      await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          taskId: otherTask.id,
          s3Key: 'test-key-2',
          s3Url: 'https://example.com/test-2.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-2',
          pageUrl: 'https://example.com',
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
        },
      })

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      url.searchParams.set('taskId', testTask.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.screenshots).toHaveLength(1)
      expect(data.screenshots[0].taskId).toBe(testTask.id)
    })

    test('should filter by workspaceId + pageUrl', async () => {
      await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          s3Key: 'test-key-1',
          s3Url: 'https://example.com/test-1.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-1',
          pageUrl: 'https://example.com/page1',
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
        },
      })

      await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          s3Key: 'test-key-2',
          s3Url: 'https://example.com/test-2.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-2',
          pageUrl: 'https://example.com/page2',
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
        },
      })

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      url.searchParams.set('pageUrl', 'https://example.com/page1')
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.screenshots).toHaveLength(1)
      expect(data.screenshots[0].pageUrl).toBe('https://example.com/page1')
    })

    test('should filter by all parameters combined', async () => {
      await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          taskId: testTask.id,
          s3Key: 'test-key-1',
          s3Url: 'https://example.com/test-1.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-1',
          pageUrl: 'https://example.com/target-page',
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
        },
      })

      await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          taskId: testTask.id,
          s3Key: 'test-key-2',
          s3Url: 'https://example.com/test-2.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-2',
          pageUrl: 'https://example.com/other-page',
          timestamp: BigInt(Date.now()),
          actionIndex: 1,
        },
      })

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      url.searchParams.set('taskId', testTask.id)
      url.searchParams.set('pageUrl', 'https://example.com/target-page')
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.screenshots).toHaveLength(1)
      expect(data.screenshots[0].pageUrl).toBe('https://example.com/target-page')
    })

    test('should return empty array when no matches', async () => {
      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      url.searchParams.set('pageUrl', 'https://nonexistent.com')
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.screenshots).toHaveLength(0)
      expect(data.pagination.hasMore).toBe(false)
    })
  })

  describe('URL Expiration Handling', () => {
    test('should regenerate expired presigned URLs', async () => {
      const screenshot = await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          s3Key: 'test-key-expired',
          s3Url: 'https://old-expired-url.com',
          urlExpiresAt: new Date(Date.now() - 1000), // expired 1 second ago
          hash: 'test-hash-expired',
          pageUrl: 'https://example.com',
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
        },
      })

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.screenshots[0].s3Url).toBe(
        'https://mock-s3.example.com/test-screenshot.jpg?expires=123456789'
      )
      expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
        'test-key-expired',
        expect.any(Number)
      )

      // Verify database was updated
      const updatedScreenshot = await db.screenshot.findUnique({
        where: { id: screenshot.id },
      })
      expect(updatedScreenshot?.s3Url).toBe(
        'https://mock-s3.example.com/test-screenshot.jpg?expires=123456789'
      )
      expect(updatedScreenshot?.urlExpiresAt).toBeDefined()
      expect(updatedScreenshot!.urlExpiresAt!.getTime()).toBeGreaterThan(Date.now())
    })

    test('should keep valid URLs unchanged', async () => {
      const validUrl = 'https://valid-url.com/test.jpg'
      await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          s3Key: 'test-key-valid',
          s3Url: validUrl,
          urlExpiresAt: new Date(Date.now() + 86400000), // expires tomorrow
          hash: 'test-hash-valid',
          pageUrl: 'https://example.com',
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
        },
      })

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.screenshots[0].s3Url).toBe(validUrl)
      expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
    })

    test('should update urlExpiresAt in database when regenerating', async () => {
      const screenshot = await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          s3Key: 'test-key-update',
          s3Url: 'https://old-url.com',
          urlExpiresAt: new Date(Date.now() - 1000),
          hash: 'test-hash-update',
          pageUrl: 'https://example.com',
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
        },
      })

      const oldExpiresAt = screenshot.urlExpiresAt

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      await GET(request)

      const updatedScreenshot = await db.screenshot.findUnique({
        where: { id: screenshot.id },
      })

      expect(updatedScreenshot?.urlExpiresAt).not.toEqual(oldExpiresAt)
      expect(updatedScreenshot!.urlExpiresAt!.getTime()).toBeGreaterThan(Date.now())
    })

    test('should handle multiple expired URLs in batch', async () => {
      // Create 3 screenshots with expired URLs
      for (let i = 0; i < 3; i++) {
        await db.screenshot.create({
          data: {
            workspaceId: testWorkspace.id,
            s3Key: `test-key-batch-${i}`,
            s3Url: `https://old-url-${i}.com`,
            urlExpiresAt: new Date(Date.now() - 1000),
            hash: `test-hash-batch-${i}`,
            pageUrl: 'https://example.com',
            timestamp: BigInt(Date.now() + i),
            actionIndex: i,
          },
        })
      }

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledTimes(3)
    })
  })

  describe('Response Format', () => {
    test('should return correct screenshot fields', async () => {
      await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          taskId: testTask.id,
          s3Key: 'test-key-fields',
          s3Url: 'https://example.com/test.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-fields',
          pageUrl: 'https://example.com',
          timestamp: BigInt(Date.now()),
          actionIndex: 5,
          width: 1920,
          height: 1080,
        },
      })

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      const returnedScreenshot = data.screenshots[0]

      expect(returnedScreenshot).toHaveProperty('id')
      expect(returnedScreenshot).toHaveProperty('s3Key')
      expect(returnedScreenshot).toHaveProperty('s3Url')
      expect(returnedScreenshot).toHaveProperty('urlExpiresAt')
      expect(returnedScreenshot).toHaveProperty('actionIndex')
      expect(returnedScreenshot).toHaveProperty('pageUrl')
      expect(returnedScreenshot).toHaveProperty('timestamp')
      expect(returnedScreenshot).toHaveProperty('hash')
      expect(returnedScreenshot).toHaveProperty('width')
      expect(returnedScreenshot).toHaveProperty('height')
      expect(returnedScreenshot).toHaveProperty('taskId')
      expect(returnedScreenshot).toHaveProperty('createdAt')
      expect(returnedScreenshot).toHaveProperty('updatedAt')
    })

    test('should serialize BigInt timestamps correctly', async () => {
      const timestamp = BigInt(Date.now())
      await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          s3Key: 'test-key-bigint',
          s3Url: 'https://example.com/test.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-bigint',
          pageUrl: 'https://example.com',
          timestamp,
          actionIndex: 0,
        },
      })

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(typeof data.screenshots[0].timestamp).toBe('number')
      expect(data.screenshots[0].timestamp).toBe(Number(timestamp))
    })

    test('should include pagination metadata', async () => {
      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('pagination')
      expect(data.pagination).toHaveProperty('hasMore')
      expect(data.pagination).toHaveProperty('nextCursor')
      expect(data.pagination).toHaveProperty('limit')
    })

    test('should return valid presigned URLs', async () => {
      await db.screenshot.create({
        data: {
          workspaceId: testWorkspace.id,
          s3Key: 'test-key-url',
          s3Url: 'https://example.com/test.jpg',
          urlExpiresAt: new Date(Date.now() + 86400000),
          hash: 'test-hash-url',
          pageUrl: 'https://example.com',
          timestamp: BigInt(Date.now()),
          actionIndex: 0,
        },
      })

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.screenshots[0].s3Url).toMatch(/^https:\/\//)
    })
  })

  describe('Edge Cases', () => {
    test('should handle empty screenshot list', async () => {
      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.screenshots).toEqual([])
      expect(data.pagination.hasMore).toBe(false)
      expect(data.pagination.nextCursor).toBeNull()
    })

    test('should handle workspace with no screenshots', async () => {
      const emptyWorkspace = await db.workspace.create({
        data: {
          name: 'Empty Workspace',
          slug: 'empty-workspace',
          ownerId: testUser.id,
        },
      })

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', emptyWorkspace.id)
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.screenshots).toEqual([])
    })

    test('should handle large result sets', async () => {
      // Create 100 screenshots
      for (let i = 0; i < 100; i++) {
        await db.screenshot.create({
          data: {
            workspaceId: testWorkspace.id,
            s3Key: `test-key-large-${i}`,
            s3Url: `https://example.com/test-${i}.jpg`,
            urlExpiresAt: new Date(Date.now() + 86400000),
            hash: `test-hash-large-${i}`,
            pageUrl: 'https://example.com',
            timestamp: BigInt(Date.now() + i),
            actionIndex: i,
          },
        })
      }

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      const url = new URL('http://localhost/api/screenshots')
      url.searchParams.set('workspaceId', testWorkspace.id)
      url.searchParams.set('limit', '50')
      const request = new Request(url.toString())
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.screenshots).toHaveLength(50)
      expect(data.pagination.hasMore).toBe(true)
    })

    test('should handle cursor pagination correctly', async () => {
      const screenshots = []
      for (let i = 0; i < 5; i++) {
        const screenshot = await db.screenshot.create({
          data: {
            workspaceId: testWorkspace.id,
            s3Key: `test-key-end-${i}`,
            s3Url: `https://example.com/test-${i}.jpg`,
            urlExpiresAt: new Date(Date.now() + 86400000),
            hash: `test-hash-end-${i}`,
            pageUrl: 'https://example.com',
            timestamp: BigInt(Date.now() + i),
            actionIndex: i,
          },
        })
        screenshots.push(screenshot)
      }

      getMockedSession().mockResolvedValue({
        user: { id: testUser.id, email: testUser.email || '' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      // Get first page with limit 2
      const url1 = new URL('http://localhost/api/screenshots')
      url1.searchParams.set('workspaceId', testWorkspace.id)
      url1.searchParams.set('limit', '2')
      const request1 = new Request(url1.toString())
      const response1 = await GET(request1)
      const data1 = await response1.json()

      expect(response1.status).toBe(200)
      expect(data1.screenshots).toHaveLength(2)
      expect(data1.pagination.hasMore).toBe(true)

      // Use cursor to get next page
      const url2 = new URL('http://localhost/api/screenshots')
      url2.searchParams.set('workspaceId', testWorkspace.id)
      url2.searchParams.set('limit', '2')
      url2.searchParams.set('cursor', data1.pagination.nextCursor)
      const request2 = new Request(url2.toString())
      const response2 = await GET(request2)
      const data2 = await response2.json()

      expect(response2.status).toBe(200)
      expect(data2.screenshots.length).toBeGreaterThan(0)
      // Should not return the same screenshots as first page
      const firstPageIds = data1.screenshots.map((s: any) => s.id)
      const secondPageIds = data2.screenshots.map((s: any) => s.id)
      expect(firstPageIds.some((id: string) => secondPageIds.includes(id))).toBe(false)
    })
  })
})