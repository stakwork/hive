import { describe, test, expect, vi, beforeEach, Mock } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/github/webhook/ensure/route'
import { getServerSession } from 'next-auth/next'
import { db } from '@/lib/db'
import { WebhookService } from '@/services/github/WebhookService'
import { getGithubWebhookCallbackUrl } from '@/lib/url'

// Mock all external dependencies
vi.mock('next-auth/next')
vi.mock('@/lib/db', () => ({
  db: {
    repository: {
      findUnique: vi.fn(),
    },
  },
}))
vi.mock('@/services/github/WebhookService')
vi.mock('@/lib/url')

describe('POST /api/github/webhook/ensure', () => {
  const mockUserId = 'user-123'
  const mockWorkspaceId = 'workspace-456'
  const mockRepositoryId = 'repo-789'
  const mockRepositoryUrl = 'https://github.com/test-org/test-repo'
  const mockCallbackUrl = 'https://test.com/api/github/webhook'
  const mockWebhookId = '123456789'

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Default mock implementations
    vi.mocked(getGithubWebhookCallbackUrl).mockReturnValue(mockCallbackUrl)
  })

  const createRequest = (body: unknown) => {
    return new NextRequest('http://localhost:3000/api/github/webhook/ensure', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  describe('Authentication', () => {
    test('should return 401 when user is not authenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null)

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data).toEqual({ success: false, message: 'Unauthorized' })
    })

    test('should return 401 when session has no user', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: null,
        expires: new Date().toISOString(),
      } as any)

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data).toEqual({ success: false, message: 'Unauthorized' })
    })
  })

  describe('Request Validation', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: mockUserId },
        expires: new Date().toISOString(),
      } as any)
    })

    test('should return 400 when workspaceId is missing', async () => {
      const request = createRequest({
        repositoryUrl: mockRepositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.message).toContain('Missing required fields')
    })

    test('should return 400 when both repositoryUrl and repositoryId are missing', async () => {
      const request = createRequest({
        workspaceId: mockWorkspaceId,
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.message).toContain('Missing required fields')
    })

    test('should accept request with workspaceId and repositoryUrl', async () => {
      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: 'test-secret',
      })
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any))

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(mockEnsureRepoWebhook).toHaveBeenCalledWith({
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
        callbackUrl: mockCallbackUrl,
      })
    })

    test('should accept request with workspaceId and repositoryId', async () => {
      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: mockRepositoryId,
        repositoryUrl: mockRepositoryUrl,
        workspaceId: mockWorkspaceId,
      } as any)

      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: 'test-secret',
      })
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any))

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryId: mockRepositoryId,
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(mockEnsureRepoWebhook).toHaveBeenCalledWith({
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
        callbackUrl: mockCallbackUrl,
      })
    })
  })

  describe('Repository Lookup', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: mockUserId },
        expires: new Date().toISOString(),
      } as any)
    })

    test('should return 404 when repository not found by repositoryId', async () => {
      vi.mocked(db.repository.findUnique).mockResolvedValue(null)

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryId: mockRepositoryId,
      })

      const response = await POST(request)

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data).toEqual({ success: false, message: 'Repository not found for workspace' })
      expect(db.repository.findUnique).toHaveBeenCalledWith({
        where: { id: mockRepositoryId },
        select: { repositoryUrl: true, workspaceId: true },
      })
    })

    test('should return 404 when repository workspaceId does not match', async () => {
      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: mockRepositoryId,
        repositoryUrl: mockRepositoryUrl,
        workspaceId: 'different-workspace',
      } as any)

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryId: mockRepositoryId,
      })

      const response = await POST(request)

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data).toEqual({ success: false, message: 'Repository not found for workspace' })
    })

    test('should return 400 when repositoryUrl is not found after lookup', async () => {
      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: mockRepositoryId,
        repositoryUrl: null,
        workspaceId: mockWorkspaceId,
      } as any)

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryId: mockRepositoryId,
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toEqual({ success: false, message: 'Repository URL not found' })
    })
  })

  describe('Successful Webhook Setup', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: mockUserId },
        expires: new Date().toISOString(),
      } as any)
    })

    test('should return 200 with webhookId on successful webhook creation', async () => {
      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: 'test-secret',
      })
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any))

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({
        success: true,
        webhookId: mockWebhookId,
      })
      expect(mockEnsureRepoWebhook).toHaveBeenCalledWith({
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
        callbackUrl: mockCallbackUrl,
      })
    })

    test('should use getGithubWebhookCallbackUrl to generate callback URL', async () => {
      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: 'test-secret',
      })
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any))

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
      })

      await POST(request)

      expect(getGithubWebhookCallbackUrl).toHaveBeenCalledWith(request)
    })
  })

  describe('Error Handling', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: mockUserId },
        expires: new Date().toISOString(),
      } as any)
    })

    test('should return 500 when WebhookService throws "Workspace not found" error', async () => {
      const mockEnsureRepoWebhook = vi.fn().mockRejectedValue(
        new Error('Workspace not found')
      )
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any))

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.message).toContain('Workspace not found')
    })

    test('should return 500 when WebhookService throws "Repository not found for workspace" error', async () => {
      const mockEnsureRepoWebhook = vi.fn().mockRejectedValue(
        new Error('Repository not found for workspace')
      )
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any))

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.message).toContain('Repository not found for workspace')
    })

    test('should return 500 when WebhookService throws "INSUFFICIENT_PERMISSIONS" error', async () => {
      const mockEnsureRepoWebhook = vi.fn().mockRejectedValue(
        new Error('INSUFFICIENT_PERMISSIONS')
      )
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any))

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.message).toContain('INSUFFICIENT_PERMISSIONS')
    })

    test('should return 500 when WebhookService throws "WEBHOOK_CREATION_FAILED" error', async () => {
      const mockEnsureRepoWebhook = vi.fn().mockRejectedValue(
        new Error('WEBHOOK_CREATION_FAILED')
      )
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any))

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.message).toContain('WEBHOOK_CREATION_FAILED')
    })

    test('should return 500 when WebhookService throws "GitHub access token not found for user" error', async () => {
      const mockEnsureRepoWebhook = vi.fn().mockRejectedValue(
        new Error('GitHub access token not found for user')
      )
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any))

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.message).toContain('GitHub access token not found for user')
    })

    test('should return 500 with generic error message for unexpected errors', async () => {
      const mockEnsureRepoWebhook = vi.fn().mockRejectedValue(
        new Error('Unexpected error')
      )
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any))

      const request = createRequest({
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.message).toBeDefined()
    })
  })
})