import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export class S3Service {
  private client: S3Client
  private bucketName: string

  constructor() {
    this.client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
    })
    
    const bucketName = process.env.S3_BUCKET_NAME
    if (!bucketName) {
      throw new Error('S3_BUCKET_NAME environment variable is required')
    }
    this.bucketName = bucketName
  }

  async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 300 // 5 minutes
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    })

    return await getSignedUrl(this.client, command, { expiresIn })
  }

  async generatePresignedDownloadUrl(
    key: string,
    expiresIn: number = 3600 // 1 hour
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    })

    return await getSignedUrl(this.client, command, { expiresIn })
  }

  generateS3Path(workspaceId: string, swarmId: string, taskId: string, filename: string): string {
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(2, 15)
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_')
    
    return `uploads/${workspaceId}/${swarmId}/${taskId}/${timestamp}_${randomId}_${sanitizedFilename}`
  }


  validateFileType(mimeType: string): boolean {
    const allowedTypes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp'
    ]
    return allowedTypes.includes(mimeType.toLowerCase())
  }

  validateFileSize(size: number): boolean {
    const maxSize = 10 * 1024 * 1024 // 10MB
    return size <= maxSize
  }
}

export const s3Service = new S3Service()