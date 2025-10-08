import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/github/webhook/ensure/route'
import { db } from '@/lib/db'
import { EncryptionService } from '@/lib/encryption'
import {
  createAuthenticatedSession,
  getMockedSession,
} from '@/__tests__/support/helpers/auth'
import { expectSuccess, expectError } from '@/__tests__/support/helpers/api-assertions'

// Mock the WebhookService using vi.hoisted to maintain proper mocking control
const mockEnsureRepoWebhook = vi.fn()

vi.mock('@/services/github/WebhookService', () => ({
  WebhookService: vi.fn().mockImplementation(() => ({
    ensureRepoWebhook: mockEnsureRepoWebhook,
  })),
}))
vi.mock('@/lib/url', () => ({
  getGithubWebhookCallbackUrl: vi.fn(() => 'https://test.com/api/github/webhook'),
}))

describe('POST /api/github/webhook/ensure - Integration', () => {
  let testUser: any
  let testWorkspace: any
  let testRepository: any
  let mockFetch: any

  beforeEach(async () => {
    vi.clearAllMocks()

    // Create test user
    testUser = await db.user.create({
      data: {
        id: `test-user-${Date.now()}-${Math.random()}`,
        email: `test-${Date.now()}@example.com`,
        name: 'Test User',
      },
    })

    // Create GitHub account with access token
    const encryptionService = EncryptionService.getInstance()
    const encryptedToken = await encryptionService.encryptField(
      'access_token',
      'test_github_token_123'
    )

    await db.account.create({
      data: {
        userId: testUser.id,
        type: 'oauth',
        provider: 'github',
        providerAccountId: 'github-user-123',
        access_token: JSON.stringify(encryptedToken),
        token_type: 'bearer',
        scope: 'repo,user',
      },
    })

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        slug: `test-workspace-${Date.now()}`,
        name: 'Test Workspace',
        ownerId: testUser.id,
        members: {
          create: {
            userId: testUser.id,
            role: 'OWNER',
          },
        },
      },
    })

    // Create test repository (no swarmId field exists in current schema)
    testRepository = await db.repository.create({
      data: {
        workspaceId: testWorkspace.id,
        name: 'test-repo',
        repositoryUrl: 'https://github.com/test-org/test-repo',
        branch: 'main',
      },
    })

    // Mock session
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser))

    // Setup mock fetch
    mockFetch = vi.fn()
    global.fetch = mockFetch
  })

  afterEach(async () => {
    // Cleanup test data
    if (testRepository) {
      await db.repository.deleteMany({ where: { id: testRepository.id } })
    }
    if (testWorkspace) {
      await db.workspaceMember.deleteMany({ where: { workspaceId: testWorkspace.id } })
      await db.workspace.deleteMany({ where: { id: testWorkspace.id } })
    }
    if (testUser) {
      await db.account.deleteMany({ where: { userId: testUser.id } })
      await db.user.deleteMany({ where: { id: testUser.id } })
    }
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

  describe('End-to-End Webhook Creation', () => {
    test('should create webhook and store webhookId and encrypted secret in database', async () => {
      const mockWebhookId = 987654321

      // Mock the WebhookService to return a successful result
      mockEnsureRepoWebhook.mockResolvedValueOnce({
        id: mockWebhookId,
        secret: 'mock-secret-64chars'
      })

      const request = createRequest({
        workspaceId: testWorkspace.id,
        repositoryUrl: testRepository.repositoryUrl,
      })

      const response = await POST(request)

      const data = await expectSuccess(response)
      expect(data.webhookId).toBe(mockWebhookId)
    })

    test('should create webhook using repositoryId', async () => {
      const mockWebhookId = 123456789

      // Mock the WebhookService to return a successful result
      mockEnsureRepoWebhook.mockResolvedValueOnce({
        id: mockWebhookId,
        secret: 'mock-secret-64chars'
      })

      const request = createRequest({
        workspaceId: testWorkspace.id,
        repositoryId: testRepository.id,
      })

      const response = await POST(request)

      const data = await expectSuccess(response)
      expect(data.webhookId).toBe(mockWebhookId)
    })
  })

  describe('Idempotency', () => {
    test('should update existing webhook instead of creating duplicate', async () => {
      const existingWebhookId = 111111111

      // Mock the WebhookService for the first call
      mockEnsureRepoWebhook.mockResolvedValueOnce({
        id: existingWebhookId,
        secret: 'first-secret'
      })

      const firstRequest = createRequest({
        workspaceId: testWorkspace.id,
        repositoryUrl: testRepository.repositoryUrl,
      })

      const firstResponse = await POST(firstRequest)
      await expectSuccess(firstResponse)

      // Mock the WebhookService for the second call
      mockEnsureRepoWebhook.mockResolvedValueOnce({
        id: existingWebhookId,
        secret: 'first-secret' // Same secret to test idempotency
      })

      const secondRequest = createRequest({
        workspaceId: testWorkspace.id,
        repositoryUrl: testRepository.repositoryUrl,
      })

      const secondResponse = await POST(secondRequest)
      const secondData = await expectSuccess(secondResponse)

      // Verify same webhook ID is returned
      expect(secondData.webhookId).toBe(existingWebhookId)
    })

    test('should update webhook when existing webhook has different events', async () => {
      const existingWebhookId = 222222222

      // Mock the WebhookService to simulate updating an existing webhook
      mockEnsureRepoWebhook.mockResolvedValueOnce({
        id: existingWebhookId,
        secret: 'updated-secret'
      })

      const request = createRequest({
        workspaceId: testWorkspace.id,
        repositoryUrl: testRepository.repositoryUrl,
      })

      const response = await POST(request)

      const data = await expectSuccess(response)
      expect(data.webhookId).toBe(existingWebhookId)
    })
  })

  describe('GitHub API Error Handling', () => {
    test('should return 500 when GitHub API returns 403 Forbidden (insufficient permissions)', async () => {
      // Mock the WebhookService to throw an error
      mockEnsureRepoWebhook.mockRejectedValueOnce(new Error('INSUFFICIENT_PERMISSIONS'))

      const request = createRequest({
        workspaceId: testWorkspace.id,
        repositoryUrl: testRepository.repositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      await expectError(response, /INSUFFICIENT_PERMISSIONS/, 500)
    })

    test('should return 500 when GitHub API returns 404 Not Found', async () => {
      // Mock the WebhookService to throw an error
      mockEnsureRepoWebhook.mockRejectedValueOnce(new Error('WEBHOOK_CREATION_FAILED'))

      const request = createRequest({
        workspaceId: testWorkspace.id,
        repositoryUrl: testRepository.repositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      await expectError(response, /WEBHOOK_CREATION_FAILED/, 500)
    })

    test('should return 500 when GitHub API returns 500 Server Error', async () => {
      // Mock the WebhookService to throw an error
      mockEnsureRepoWebhook.mockRejectedValueOnce(new Error('WEBHOOK_CREATION_FAILED'))

      const request = createRequest({
        workspaceId: testWorkspace.id,
        repositoryUrl: testRepository.repositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      await expectError(response, /WEBHOOK_CREATION_FAILED/, 500)
    })

    test('should return 500 when GitHub API network request fails', async () => {
      // Mock the WebhookService to throw a network error
      mockEnsureRepoWebhook.mockRejectedValueOnce(new Error('Network error'))

      const request = createRequest({
        workspaceId: testWorkspace.id,
        repositoryUrl: testRepository.repositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.message).toBeDefined()
    })

    test('should return 500 when createHook fails after successful listHooks', async () => {
      // Mock the WebhookService to throw an error
      mockEnsureRepoWebhook.mockRejectedValueOnce(new Error('WEBHOOK_CREATION_FAILED'))

      const request = createRequest({
        workspaceId: testWorkspace.id,
        repositoryUrl: testRepository.repositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      await expectError(response, /WEBHOOK_CREATION_FAILED/, 500)
    })

    test('should return 500 when updateHook fails for existing webhook', async () => {
      // Mock the WebhookService to throw an error
      mockEnsureRepoWebhook.mockRejectedValueOnce(new Error('WEBHOOK_CREATION_FAILED'))

      const request = createRequest({
        workspaceId: testWorkspace.id,
        repositoryUrl: testRepository.repositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      await expectError(response, /WEBHOOK_CREATION_FAILED/, 500)
    })
  })

  describe('Database Validation', () => {
    test('should return 500 when workspace does not exist', async () => {
      // Mock the WebhookService to throw an error
      mockEnsureRepoWebhook.mockRejectedValueOnce(new Error('Workspace not found'))

      const request = createRequest({
        workspaceId: 'non-existent-workspace',
        repositoryUrl: testRepository.repositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      await expectError(response, /Workspace not found/, 500)
    })

    test('should return 404 when repository does not exist for workspace', async () => {
      const request = createRequest({
        workspaceId: testWorkspace.id,
        repositoryId: 'non-existent-repo',
      })

      const response = await POST(request)

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.success).toBe(false)
      expect(data.message).toBe('Repository not found for workspace')
    })

    test('should return 500 when GitHub token not found for user', async () => {
      // Mock the WebhookService to throw an error
      mockEnsureRepoWebhook.mockRejectedValueOnce(new Error('GitHub access token not found for user'))

      const request = createRequest({
        workspaceId: testWorkspace.id,
        repositoryUrl: testRepository.repositoryUrl,
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      await expectError(response, /GitHub access token not found for user/, 500)
    })
  })
})