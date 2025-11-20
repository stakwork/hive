import { describe, test, expect, beforeEach, vi } from 'vitest'
import { POST as uploadUrlPost } from '@/app/api/workspaces/[slug]/settings/image/upload-url/route'
import { POST as confirmPost } from '@/app/api/workspaces/[slug]/settings/image/confirm/route'
import { GET as imageGet } from '@/app/api/workspaces/[slug]/image/route'
import { DELETE as imageDelete } from '@/app/api/workspaces/[slug]/settings/image/route'
import { db } from '@/lib/db'
import { WorkspaceRole } from '@prisma/client'
import {
  generateUniqueId,
  createPostRequest,
  createGetRequest,
  createDeleteRequest,
  createAuthenticatedPostRequest,
  createAuthenticatedGetRequest,
  createAuthenticatedDeleteRequest,
} from '@/__tests__/support/helpers'
import sharp from 'sharp'

const mockS3Service = {
  validateFileType: vi.fn(),
  validateFileSize: vi.fn(),
  validateImageBuffer: vi.fn(),
  generateWorkspaceLogoPath: vi.fn(),
  generatePresignedUploadUrl: vi.fn(),
  generatePresignedDownloadUrl: vi.fn(),
  getObject: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
}

vi.mock('@/services/s3', () => ({
  getS3Service: vi.fn(() => mockS3Service),
}))

vi.mock('next-auth/next', () => ({
  auth: vi.fn(),
}))

vi.mock('@/auth', () => ({
  authOptions: {},
}))

describe('Workspace Logo API Integration Tests', () => {
  async function createTestUserAndWorkspace(role: WorkspaceRole = WorkspaceRole.OWNER) {
    return await db.$transaction(async (tx) => {
      const testUser = await tx.user.create({
        data: {
          id: generateUniqueId('user'),
          email: `test-${generateUniqueId()}@example.com`,
          name: 'Test User',
        },
      })

      // If role is OWNER, make testUser the owner
      // Otherwise, create a separate owner and add testUser as a member
      const ownerUser = role === WorkspaceRole.OWNER
        ? testUser
        : await tx.user.create({
            data: {
              id: generateUniqueId('user'),
              email: `owner-${generateUniqueId()}@example.com`,
              name: 'Workspace Owner',
            },
          })

      const testWorkspace = await tx.workspace.create({
        data: {
          id: generateUniqueId('workspace'),
          name: 'Test Workspace',
          slug: generateUniqueId('test-workspace'),
          ownerId: ownerUser.id,
        },
      })

      // If role is not OWNER, create a workspace member with the specified role
      if (role !== WorkspaceRole.OWNER) {
        await tx.workspaceMember.create({
          data: {
            workspaceId: testWorkspace.id,
            userId: testUser.id,
            role,
          },
        })
      }

      return { testUser, testWorkspace }
    })
  }

  async function createTestImage(format: 'jpeg' | 'png' | 'gif' | 'webp' = 'jpeg') {
    return await sharp({
      create: {
        width: 1600,
        height: 600,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      [format]()
      .toBuffer()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/workspaces/[slug]/settings/image/upload-url', () => {
    describe('Authentication Tests', () => {
      test('should return 401 for unauthenticated request', async () => {
        const request = createPostRequest(
          'http://localhost:3000/api/workspaces/test/settings/image/upload-url',
          {
            filename: 'logo.jpg',
            contentType: 'image/jpeg',
            size: 500000,
          }
        )

        const response = await uploadUrlPost(request, {
          params: Promise.resolve({ slug: 'test' }),
        })

        expect(response.status).toBe(401)
        const body = await response.json()
        expect(body.error).toBe('Unauthorized')
      })
    })

    describe('Workspace Access Tests', () => {
      test('should return 404 for non-existent workspace', async () => {
        const { testUser } = await createTestUserAndWorkspace()

        const request = createAuthenticatedPostRequest(
          'http://localhost:3000/api/workspaces/non-existent/settings/image/upload-url',
          {
            filename: 'logo.jpg',
            contentType: 'image/jpeg',
            size: 500000,
          },
          testUser
        )

        const response = await uploadUrlPost(request, {
          params: Promise.resolve({ slug: 'non-existent' }),
        })

        expect(response.status).toBe(404)
        const body = await response.json()
        expect(body.error).toContain('not found')
      })
    })

    describe('Permission Tests', () => {
      test('should allow OWNER to upload logo', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace(
          WorkspaceRole.OWNER
        )
        

        mockS3Service.validateFileType.mockReturnValue(true)
        mockS3Service.validateFileSize.mockReturnValue(true)
        mockS3Service.generateWorkspaceLogoPath.mockReturnValue(
          'workspace-logos/test/123.jpg'
        )
        mockS3Service.generatePresignedUploadUrl.mockResolvedValue(
          'https://s3.amazonaws.com/presigned-url'
        )

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/upload-url`, {
            filename: 'logo.jpg',
            contentType: 'image/jpeg',
            size: 500000,
          }, testUser)

        const response = await uploadUrlPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.presignedUrl).toBe('https://s3.amazonaws.com/presigned-url')
        expect(body.s3Path).toBe('workspace-logos/test/123.jpg')
      })

      test('should allow ADMIN to upload logo', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace(
          WorkspaceRole.ADMIN
        )
        

        mockS3Service.validateFileType.mockReturnValue(true)
        mockS3Service.validateFileSize.mockReturnValue(true)
        mockS3Service.generateWorkspaceLogoPath.mockReturnValue(
          'workspace-logos/test/123.jpg'
        )
        mockS3Service.generatePresignedUploadUrl.mockResolvedValue(
          'https://s3.amazonaws.com/presigned-url'
        )

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/upload-url`, {
            filename: 'logo.jpg',
            contentType: 'image/jpeg',
            size: 500000,
          }, testUser)

        const response = await uploadUrlPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(200)
      })

      test('should return 403 for DEVELOPER role', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace(
          WorkspaceRole.DEVELOPER
        )
        

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/upload-url`, {
            filename: 'logo.jpg',
            contentType: 'image/jpeg',
            size: 500000,
          }, testUser)

        const response = await uploadUrlPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(403)
        const body = await response.json()
        expect(body.error).toContain('Only workspace owners and admins')
      })

      test('should return 403 for VIEWER role', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace(
          WorkspaceRole.VIEWER
        )
        

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/upload-url`, {
            filename: 'logo.jpg',
            contentType: 'image/jpeg',
            size: 500000,
          }, testUser)

        const response = await uploadUrlPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(403)
      })
    })

    describe('Validation Tests', () => {
      test('should reject invalid file type', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()
        

        mockS3Service.validateFileType.mockReturnValue(false)

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/upload-url`, {
            filename: 'document.pdf',
            contentType: 'application/pdf',
            size: 500000,
          }, testUser)

        const response = await uploadUrlPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(400)
        const body = await response.json()
        expect(body.error).toContain('Invalid file type')
      })

      test('should reject file exceeding 1MB limit', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()
        

        mockS3Service.validateFileType.mockReturnValue(true)
        mockS3Service.validateFileSize.mockReturnValue(false)

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/upload-url`, {
            filename: 'large-logo.jpg',
            contentType: 'image/jpeg',
            size: 2 * 1024 * 1024,
          }, testUser)

        const response = await uploadUrlPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(400)
        const body = await response.json()
        expect(body.error).toBe('Invalid request data')
      })

      test('should reject request with missing filename', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()
        

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/upload-url`, {
            contentType: 'image/jpeg',
            size: 500000,
          }, testUser)

        const response = await uploadUrlPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(400)
      })
    })

    describe('Presigned URL Generation Tests', () => {
      test('should generate presigned URL with 15 minute expiry', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()
        

        mockS3Service.validateFileType.mockReturnValue(true)
        mockS3Service.validateFileSize.mockReturnValue(true)
        mockS3Service.generateWorkspaceLogoPath.mockReturnValue(
          'workspace-logos/test/123.jpg'
        )
        mockS3Service.generatePresignedUploadUrl.mockResolvedValue(
          'https://s3.amazonaws.com/presigned-url'
        )

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/upload-url`, {
            filename: 'logo.jpg',
            contentType: 'image/jpeg',
            size: 500000,
          }, testUser)

        await uploadUrlPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(mockS3Service.generatePresignedUploadUrl).toHaveBeenCalledWith(
          'workspace-logos/test/123.jpg',
          'image/jpeg',
          900
        )
      })

      test('should return all required fields in response', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()
        

        mockS3Service.validateFileType.mockReturnValue(true)
        mockS3Service.validateFileSize.mockReturnValue(true)
        mockS3Service.generateWorkspaceLogoPath.mockReturnValue(
          'workspace-logos/test/123.jpg'
        )
        mockS3Service.generatePresignedUploadUrl.mockResolvedValue(
          'https://s3.amazonaws.com/presigned-url'
        )

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/upload-url`, {
            filename: 'logo.jpg',
            contentType: 'image/jpeg',
            size: 500000,
          }, testUser)

        const response = await uploadUrlPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        const body = await response.json()
        expect(body).toHaveProperty('presignedUrl')
        expect(body).toHaveProperty('s3Path')
        expect(body).toHaveProperty('filename')
        expect(body).toHaveProperty('contentType')
        expect(body).toHaveProperty('size')
        expect(body).toHaveProperty('expiresIn')
        expect(body.expiresIn).toBe(900)
      })
    })
  })

  describe('POST /api/workspaces/[slug]/settings/image/confirm', () => {
    describe('Authentication Tests', () => {
      test('should return 401 for unauthenticated request', async () => {
        const request = createPostRequest(
          'http://localhost:3000/api/workspaces/test/settings/image/confirm',
          {
            s3Path: 'workspace-logos/test/123.jpg',
            filename: 'logo.jpg',
            mimeType: 'image/jpeg',
            size: 500000,
          }
        )

        const response = await confirmPost(request, {
          params: Promise.resolve({ slug: 'test' }),
        })

        expect(response.status).toBe(401)
      })
    })

    describe('Permission Tests', () => {
      test('should allow ADMIN to confirm upload', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace(
          WorkspaceRole.ADMIN
        )

        const testImage = await createTestImage('jpeg')
        mockS3Service.getObject.mockResolvedValue(testImage)
        mockS3Service.validateImageBuffer.mockReturnValue(true)
        mockS3Service.putObject.mockResolvedValue(undefined)

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/confirm`, {
            s3Path: 'workspace-logos/test/123.jpg',
            filename: 'logo.jpg',
            mimeType: 'image/jpeg',
            size: 500000,
          }, testUser)

        const response = await confirmPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(200)
      })

      test('should return 403 for non-admin user', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace(
          WorkspaceRole.VIEWER
        )
        

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/confirm`, {
            s3Path: 'workspace-logos/test/123.jpg',
            filename: 'logo.jpg',
            mimeType: 'image/jpeg',
            size: 500000,
          }, testUser)

        const response = await confirmPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(403)
      })
    })

    describe('Image Processing Tests', () => {
      test('should process and save valid image', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()

        const testImage = await createTestImage('jpeg')
        mockS3Service.getObject.mockResolvedValue(testImage)
        mockS3Service.validateImageBuffer.mockReturnValue(true)
        mockS3Service.putObject.mockResolvedValue(undefined)

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/confirm`, {
            s3Path: 'workspace-logos/test/123.jpg',
            filename: 'logo.jpg',
            mimeType: 'image/jpeg',
            size: 500000,
          }, testUser)

        const response = await confirmPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.success).toBe(true)
        expect(body.logoKey).toBe('workspace-logos/test/123.jpg')

        const workspace = await db.workspace.findUnique({
          where: { id: testWorkspace.id },
        })
        expect(workspace?.logoKey).toBe('workspace-logos/test/123.jpg')
      })

      test('should delete old logo when uploading new one', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()

        await db.workspace.update({
          where: { id: testWorkspace.id },
          data: { logoKey: 'workspace-logos/test/old.jpg' },
        })

        

        const testImage = await createTestImage('jpeg')
        mockS3Service.getObject.mockResolvedValue(testImage)
        mockS3Service.validateImageBuffer.mockReturnValue(true)
        mockS3Service.putObject.mockResolvedValue(undefined)
        mockS3Service.deleteObject.mockResolvedValue(undefined)

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/confirm`, {
            s3Path: 'workspace-logos/test/new.jpg',
            filename: 'logo.jpg',
            mimeType: 'image/jpeg',
            size: 500000,
          }, testUser)

        await confirmPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(mockS3Service.deleteObject).toHaveBeenCalledWith(
          'workspace-logos/test/old.jpg'
        )
      })

      test('should reject corrupt image file', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()

        const corruptBuffer = Buffer.from('not an image')
        mockS3Service.getObject.mockResolvedValue(corruptBuffer)
        mockS3Service.validateImageBuffer.mockReturnValue(false)
        mockS3Service.deleteObject.mockResolvedValue(undefined)

        const request = createAuthenticatedPostRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image/confirm`, {
            s3Path: 'workspace-logos/test/123.jpg',
            filename: 'logo.jpg',
            mimeType: 'image/jpeg',
            size: 500000,
          }, testUser)

        const response = await confirmPost(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(400)
        expect(mockS3Service.deleteObject).toHaveBeenCalledWith(
          'workspace-logos/test/123.jpg'
        )
      })
    })
  })

  describe('GET /api/workspaces/[slug]/image', () => {
    describe('Authentication Tests', () => {
      test('should return 401 for unauthenticated request', async () => {
        const request = createGetRequest('http://localhost:3000/api/workspaces/test/image')

        const response = await imageGet(request, {
          params: Promise.resolve({ slug: 'test' }),
        })

        expect(response.status).toBe(401)
      })
    })

    describe('Logo Retrieval Tests', () => {
      test('should return presigned URL for workspace with logo', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()

        await db.workspace.update({
          where: { id: testWorkspace.id },
          data: { logoKey: 'workspace-logos/test/123.jpg' },
        })

        
        mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
          'https://s3.amazonaws.com/download-url'
        )

        const request = createAuthenticatedGetRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/image`, testUser)

        const response = await imageGet(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.presignedUrl).toBe('https://s3.amazonaws.com/download-url')
        expect(body.expiresIn).toBe(3600)
      })

      test('should return 404 for workspace without logo', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()
        

        const request = createAuthenticatedGetRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/image`, testUser)

        const response = await imageGet(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(404)
        const body = await response.json()
        expect(body.error).toContain('no logo')
      })

      test('should allow any workspace member to retrieve logo', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace(
          WorkspaceRole.VIEWER
        )

        await db.workspace.update({
          where: { id: testWorkspace.id },
          data: { logoKey: 'workspace-logos/test/123.jpg' },
        })

        
        mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
          'https://s3.amazonaws.com/download-url'
        )

        const request = createAuthenticatedGetRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/image`, testUser)

        const response = await imageGet(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(200)
      })

      test('should generate 1 hour expiry for download URL', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()

        await db.workspace.update({
          where: { id: testWorkspace.id },
          data: { logoKey: 'workspace-logos/test/123.jpg' },
        })

        
        mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(
          'https://s3.amazonaws.com/download-url'
        )

        const request = createAuthenticatedGetRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/image`, testUser)

        await imageGet(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(
          'workspace-logos/test/123.jpg',
          3600
        )
      })
    })
  })

  describe('DELETE /api/workspaces/[slug]/settings/image', () => {
    describe('Authentication Tests', () => {
      test('should return 401 for unauthenticated request', async () => {
        const request = createDeleteRequest(
          'http://localhost:3000/api/workspaces/test/settings/image'
        )

        const response = await imageDelete(request, {
          params: Promise.resolve({ slug: 'test' }),
        })

        expect(response.status).toBe(401)
      })
    })

    describe('Permission Tests', () => {
      test('should allow OWNER to delete logo', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()

        await db.workspace.update({
          where: { id: testWorkspace.id },
          data: { logoKey: 'workspace-logos/test/123.jpg' },
        })

        
        mockS3Service.deleteObject.mockResolvedValue(undefined)

        const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image`, testUser)

        const response = await imageDelete(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(200)
      })

      test('should allow ADMIN to delete logo', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace(
          WorkspaceRole.ADMIN
        )

        await db.workspace.update({
          where: { id: testWorkspace.id },
          data: { logoKey: 'workspace-logos/test/123.jpg' },
        })

        
        mockS3Service.deleteObject.mockResolvedValue(undefined)

        const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image`, testUser)

        const response = await imageDelete(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(200)
      })

      test('should return 403 for DEVELOPER role', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace(
          WorkspaceRole.DEVELOPER
        )

        await db.workspace.update({
          where: { id: testWorkspace.id },
          data: { logoKey: 'workspace-logos/test/123.jpg' },
        })

        

        const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image`, testUser)

        const response = await imageDelete(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(403)
      })
    })

    describe('Logo Deletion Tests', () => {
      test('should delete logo from S3 and clear database fields', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()

        await db.workspace.update({
          where: { id: testWorkspace.id },
          data: {
            logoKey: 'workspace-logos/test/123.jpg',
            logoUrl: 'https://example.com/logo.jpg',
          },
        })

        
        mockS3Service.deleteObject.mockResolvedValue(undefined)

        const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image`, testUser)

        const response = await imageDelete(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.success).toBe(true)

        expect(mockS3Service.deleteObject).toHaveBeenCalledWith(
          'workspace-logos/test/123.jpg'
        )

        const workspace = await db.workspace.findUnique({
          where: { id: testWorkspace.id },
        })
        expect(workspace?.logoKey).toBeNull()
        expect(workspace?.logoUrl).toBeNull()
      })

      test('should return 404 when workspace has no logo', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()
        

        const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image`, testUser)

        const response = await imageDelete(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(404)
        const body = await response.json()
        expect(body.error).toContain('no logo')
      })

      test('should handle S3 deletion failures gracefully', async () => {
        const { testUser, testWorkspace } = await createTestUserAndWorkspace()

        await db.workspace.update({
          where: { id: testWorkspace.id },
          data: { logoKey: 'workspace-logos/test/123.jpg' },
        })

        
        mockS3Service.deleteObject.mockRejectedValue(new Error('S3 Error'))

        const request = createAuthenticatedDeleteRequest(`http://localhost:3000/api/workspaces/${testWorkspace.slug}/settings/image`, testUser)

        const response = await imageDelete(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        })

        expect(response.status).toBe(200)

        const workspace = await db.workspace.findUnique({
          where: { id: testWorkspace.id },
        })
        expect(workspace?.logoKey).toBeNull()
      })
    })
  })
})
