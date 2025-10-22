import { describe, it, expect, beforeAll, vi } from 'vitest'
import sharp from 'sharp'
import { getS3Service } from '@/services/s3'

describe('S3 Service', () => {
  let s3Service: ReturnType<typeof getS3Service>

  beforeAll(() => {
    // Mock AWS environment variables for testing
    vi.stubEnv('AWS_ROLE_ARN', 'arn:aws:iam::123456789012:role/test-role')
    vi.stubEnv('S3_BUCKET_NAME', 'test-bucket')
    vi.stubEnv('AWS_REGION', 'us-east-1')
    s3Service = getS3Service()
  })

  describe('validateImageBuffer', () => {
    it('should validate JPEG magic numbers', async () => {
      const jpegBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .jpeg()
        .toBuffer()

      expect(s3Service.validateImageBuffer(jpegBuffer, 'image/jpeg')).toBe(true)
    })

    it('should validate PNG magic numbers', async () => {
      const pngBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 4,
          background: { r: 0, g: 255, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer()

      expect(s3Service.validateImageBuffer(pngBuffer, 'image/png')).toBe(true)
    })

    it('should validate GIF magic numbers', async () => {
      const gifBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 0, g: 0, b: 255 },
        },
      })
        .gif()
        .toBuffer()

      expect(s3Service.validateImageBuffer(gifBuffer, 'image/gif')).toBe(true)
    })

    it('should validate WebP magic numbers', async () => {
      const webpBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 255, b: 0 },
        },
      })
        .webp()
        .toBuffer()

      expect(s3Service.validateImageBuffer(webpBuffer, 'image/webp')).toBe(true)
    })

    it('should reject buffer with mismatched MIME type', async () => {
      const jpegBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .jpeg()
        .toBuffer()

      expect(s3Service.validateImageBuffer(jpegBuffer, 'image/png')).toBe(false)
    })

    it('should reject buffer that is too short', () => {
      const shortBuffer = Buffer.from([0xff, 0xd8])

      expect(s3Service.validateImageBuffer(shortBuffer, 'image/jpeg')).toBe(false)
    })

    it('should reject unsupported MIME type', () => {
      const buffer = Buffer.from([0, 1, 2, 3, 4])

      expect(s3Service.validateImageBuffer(buffer, 'image/svg+xml')).toBe(false)
    })

    it('should handle empty buffer', () => {
      const emptyBuffer = Buffer.from([])

      expect(s3Service.validateImageBuffer(emptyBuffer, 'image/jpeg')).toBe(false)
    })
  })

  describe('validateFileType', () => {
    it('should accept supported image types', () => {
      expect(s3Service.validateFileType('image/jpeg')).toBe(true)
      expect(s3Service.validateFileType('image/png')).toBe(true)
      expect(s3Service.validateFileType('image/gif')).toBe(true)
      expect(s3Service.validateFileType('image/webp')).toBe(true)
    })

    it('should reject unsupported types', () => {
      expect(s3Service.validateFileType('image/svg+xml')).toBe(false)
      expect(s3Service.validateFileType('application/pdf')).toBe(false)
      expect(s3Service.validateFileType('text/plain')).toBe(false)
    })
  })

  describe('validateFileSize', () => {
    it('should accept file size under default limit (10MB)', () => {
      const size = 5 * 1024 * 1024 // 5MB
      expect(s3Service.validateFileSize(size)).toBe(true)
    })

    it('should accept file size exactly at default limit (10MB)', () => {
      const size = 10 * 1024 * 1024 // 10MB
      expect(s3Service.validateFileSize(size)).toBe(true)
    })

    it('should reject file size over default limit (10MB)', () => {
      const size = 11 * 1024 * 1024 // 11MB
      expect(s3Service.validateFileSize(size)).toBe(false)
    })

    it('should accept file size under custom limit', () => {
      const size = 500 * 1024 // 500KB
      const customLimit = 1024 * 1024 // 1MB
      expect(s3Service.validateFileSize(size, customLimit)).toBe(true)
    })

    it('should reject file size over custom limit', () => {
      const size = 2 * 1024 * 1024 // 2MB
      const customLimit = 1024 * 1024 // 1MB
      expect(s3Service.validateFileSize(size, customLimit)).toBe(false)
    })
  })

  describe('generateWorkspaceLogoPath', () => {
    it('should generate valid S3 path for workspace logo', () => {
      const workspaceId = 'workspace-123'
      const filename = 'logo.png'

      const path = s3Service.generateWorkspaceLogoPath(workspaceId, filename)

      expect(path).toContain('workspace-logos/')
      expect(path).toContain(workspaceId)
      expect(path).toMatch(/\.png$/)
    })

    it('should sanitize filename with special characters', () => {
      const workspaceId = 'workspace-123'
      const filename = 'my logo!@#$.png'

      const path = s3Service.generateWorkspaceLogoPath(workspaceId, filename)

      expect(path).not.toContain('!')
      expect(path).not.toContain('@')
      expect(path).not.toContain('#')
      expect(path).not.toContain('$')
    })
  })
})
