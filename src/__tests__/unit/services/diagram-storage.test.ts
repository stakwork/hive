import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DiagramStorageService, getDiagramStorageService } from '@/services/diagram-storage'
import { getS3Service } from '@/services/s3'

// Mock the S3 service
vi.mock('@/services/s3', () => ({
  getS3Service: vi.fn(),
}))

describe('DiagramStorageService', () => {
  let diagramStorageService: DiagramStorageService
  let mockS3Service: {
    putObject: ReturnType<typeof vi.fn>
    generatePresignedDownloadUrl: ReturnType<typeof vi.fn>
    deleteObject: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    // Create mock S3 service methods
    mockS3Service = {
      putObject: vi.fn(),
      generatePresignedDownloadUrl: vi.fn(),
      deleteObject: vi.fn(),
    }

    // Mock getS3Service to return our mock
    vi.mocked(getS3Service).mockReturnValue(mockS3Service as any)

    // Create fresh instance for each test
    diagramStorageService = new DiagramStorageService()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('uploadDiagram', () => {
    it('should upload diagram to S3 with correct path structure', async () => {
      const buffer = Buffer.from('fake-png-data')
      const featureId = 'feature-123'
      const workspaceId = 'workspace-456'
      const mockPresignedUrl = 'https://s3.amazonaws.com/bucket/presigned-url'

      mockS3Service.putObject.mockResolvedValue(undefined)
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue(mockPresignedUrl)

      const result = await diagramStorageService.uploadDiagram(
        buffer,
        featureId,
        workspaceId
      )

      // Verify putObject was called with correct parameters
      expect(mockS3Service.putObject).toHaveBeenCalledOnce()
      const putObjectCall = mockS3Service.putObject.mock.calls[0]
      expect(putObjectCall[0]).toMatch(/^diagrams\/workspace-456\/feature-123\/\d+\.png$/)
      expect(putObjectCall[1]).toBe(buffer)
      expect(putObjectCall[2]).toBe('image/png')

      // Verify presigned URL was generated
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledOnce()
      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        expect.stringMatching(/^diagrams\/workspace-456\/feature-123\/\d+\.png$/),
        604800 // 7 days in seconds (AWS max limit)
      )

      // Verify return value
      expect(result).toEqual({
        s3Key: expect.stringMatching(/^diagrams\/workspace-456\/feature-123\/\d+\.png$/),
        s3Url: mockPresignedUrl,
      })
    })

    it('should generate unique paths for multiple uploads to same feature', async () => {
      const buffer = Buffer.from('fake-png-data')
      const featureId = 'feature-123'
      const workspaceId = 'workspace-456'

      mockS3Service.putObject.mockResolvedValue(undefined)
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue('https://url1.com')

      const result1 = await diagramStorageService.uploadDiagram(
        buffer,
        featureId,
        workspaceId
      )

      // Wait a tick to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10))

      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue('https://url2.com')

      const result2 = await diagramStorageService.uploadDiagram(
        buffer,
        featureId,
        workspaceId
      )

      // Paths should be different due to timestamp
      expect(result1.s3Key).not.toBe(result2.s3Key)
      expect(result1.s3Key).toMatch(/^diagrams\/workspace-456\/feature-123\/\d+\.png$/)
      expect(result2.s3Key).toMatch(/^diagrams\/workspace-456\/feature-123\/\d+\.png$/)
    })

    it('should handle S3 upload failures', async () => {
      const buffer = Buffer.from('fake-png-data')
      const featureId = 'feature-123'
      const workspaceId = 'workspace-456'

      mockS3Service.putObject.mockRejectedValue(new Error('S3 upload failed'))

      await expect(
        diagramStorageService.uploadDiagram(buffer, featureId, workspaceId)
      ).rejects.toThrow('S3 upload failed')

      // Verify presigned URL was not generated
      expect(mockS3Service.generatePresignedDownloadUrl).not.toHaveBeenCalled()
    })

    it('should handle presigned URL generation failures', async () => {
      const buffer = Buffer.from('fake-png-data')
      const featureId = 'feature-123'
      const workspaceId = 'workspace-456'

      mockS3Service.putObject.mockResolvedValue(undefined)
      mockS3Service.generatePresignedDownloadUrl.mockRejectedValue(
        new Error('Failed to generate presigned URL')
      )

      await expect(
        diagramStorageService.uploadDiagram(buffer, featureId, workspaceId)
      ).rejects.toThrow('Failed to generate presigned URL')

      // Verify putObject was still called
      expect(mockS3Service.putObject).toHaveBeenCalledOnce()
    })

    it('should handle bucket access denied errors', async () => {
      const buffer = Buffer.from('fake-png-data')
      const featureId = 'feature-123'
      const workspaceId = 'workspace-456'

      const accessDeniedError = new Error('Access Denied')
      Object.assign(accessDeniedError, { code: 'AccessDenied' })

      mockS3Service.putObject.mockRejectedValue(accessDeniedError)

      await expect(
        diagramStorageService.uploadDiagram(buffer, featureId, workspaceId)
      ).rejects.toThrow('Access Denied')
    })

    it('should handle network failures', async () => {
      const buffer = Buffer.from('fake-png-data')
      const featureId = 'feature-123'
      const workspaceId = 'workspace-456'

      const networkError = new Error('Network request failed')
      Object.assign(networkError, { code: 'NetworkingError' })

      mockS3Service.putObject.mockRejectedValue(networkError)

      await expect(
        diagramStorageService.uploadDiagram(buffer, featureId, workspaceId)
      ).rejects.toThrow('Network request failed')
    })

    it('should use correct content type for PNG', async () => {
      const buffer = Buffer.from('fake-png-data')
      const featureId = 'feature-123'
      const workspaceId = 'workspace-456'

      mockS3Service.putObject.mockResolvedValue(undefined)
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue('https://url.com')

      await diagramStorageService.uploadDiagram(buffer, featureId, workspaceId)

      const putObjectCall = mockS3Service.putObject.mock.calls[0]
      expect(putObjectCall[2]).toBe('image/png')
    })

    it('should use 7 day expiration for presigned URLs (AWS max limit)', async () => {
      const buffer = Buffer.from('fake-png-data')
      const featureId = 'feature-123'
      const workspaceId = 'workspace-456'

      mockS3Service.putObject.mockResolvedValue(undefined)
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue('https://url.com')

      await diagramStorageService.uploadDiagram(buffer, featureId, workspaceId)

      expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        expect.any(String),
        604800 // 7 days = 7 * 24 * 60 * 60 seconds (AWS max limit)
      )
    })
  })

  describe('deleteDiagram', () => {
    it('should delete diagram from S3', async () => {
      const s3Key = 'diagrams/workspace-456/feature-123/1234567890.png'

      mockS3Service.deleteObject.mockResolvedValue(undefined)

      await diagramStorageService.deleteDiagram(s3Key)

      expect(mockS3Service.deleteObject).toHaveBeenCalledOnce()
      expect(mockS3Service.deleteObject).toHaveBeenCalledWith(s3Key)
    })

    it('should handle S3 delete failures', async () => {
      const s3Key = 'diagrams/workspace-456/feature-123/1234567890.png'

      mockS3Service.deleteObject.mockRejectedValue(new Error('Delete failed'))

      await expect(
        diagramStorageService.deleteDiagram(s3Key)
      ).rejects.toThrow('Delete failed')
    })

    it('should handle non-existent file deletion', async () => {
      const s3Key = 'diagrams/workspace-456/feature-123/nonexistent.png'

      const notFoundError = new Error('The specified key does not exist.')
      Object.assign(notFoundError, { code: 'NoSuchKey' })

      mockS3Service.deleteObject.mockRejectedValue(notFoundError)

      await expect(
        diagramStorageService.deleteDiagram(s3Key)
      ).rejects.toThrow('The specified key does not exist.')
    })

    it('should handle bucket access denied on delete', async () => {
      const s3Key = 'diagrams/workspace-456/feature-123/1234567890.png'

      const accessDeniedError = new Error('Access Denied')
      Object.assign(accessDeniedError, { code: 'AccessDenied' })

      mockS3Service.deleteObject.mockRejectedValue(accessDeniedError)

      await expect(
        diagramStorageService.deleteDiagram(s3Key)
      ).rejects.toThrow('Access Denied')
    })

    it('should handle network failures on delete', async () => {
      const s3Key = 'diagrams/workspace-456/feature-123/1234567890.png'

      const networkError = new Error('Network request failed')
      Object.assign(networkError, { code: 'NetworkingError' })

      mockS3Service.deleteObject.mockRejectedValue(networkError)

      await expect(
        diagramStorageService.deleteDiagram(s3Key)
      ).rejects.toThrow('Network request failed')
    })
  })

  describe('path generation', () => {
    it('should generate path with correct structure', async () => {
      const buffer = Buffer.from('test')
      const featureId = 'feat-abc'
      const workspaceId = 'ws-xyz'

      mockS3Service.putObject.mockResolvedValue(undefined)
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue('https://url.com')

      const result = await diagramStorageService.uploadDiagram(
        buffer,
        featureId,
        workspaceId
      )

      // Verify path structure: diagrams/{workspaceId}/{featureId}/{timestamp}.png
      const pathParts = result.s3Key.split('/')
      expect(pathParts).toHaveLength(4)
      expect(pathParts[0]).toBe('diagrams')
      expect(pathParts[1]).toBe(workspaceId)
      expect(pathParts[2]).toBe(featureId)
      expect(pathParts[3]).toMatch(/^\d+\.png$/)
    })

    it('should include timestamp in filename', async () => {
      const buffer = Buffer.from('test')
      const featureId = 'feature-123'
      const workspaceId = 'workspace-456'

      mockS3Service.putObject.mockResolvedValue(undefined)
      mockS3Service.generatePresignedDownloadUrl.mockResolvedValue('https://url.com')

      const beforeTimestamp = Date.now()
      const result = await diagramStorageService.uploadDiagram(
        buffer,
        featureId,
        workspaceId
      )
      const afterTimestamp = Date.now()

      // Extract timestamp from path
      const filename = result.s3Key.split('/').pop()!
      const timestamp = parseInt(filename.replace('.png', ''))

      expect(timestamp).toBeGreaterThanOrEqual(beforeTimestamp)
      expect(timestamp).toBeLessThanOrEqual(afterTimestamp)
    })
  })

  describe('getDiagramStorageService singleton', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getDiagramStorageService()
      const instance2 = getDiagramStorageService()

      expect(instance1).toBe(instance2)
    })
  })
})
