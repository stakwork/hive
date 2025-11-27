import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { awsCredentialsProvider } from '@vercel/functions/oidc'

const IMAGE_MAGIC_NUMBERS: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/gif': [0x47, 0x49, 0x46],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
}

const VIDEO_MAGIC_NUMBERS: Record<string, number[]> = {
  'video/webm': [0x1a, 0x45, 0xdf, 0xa3],
}

export class S3Service {
  private client: S3Client
  private bucketName: string

  constructor() {
    const region = process.env.AWS_REGION || 'us-east-1'
    const roleArn = process.env.AWS_ROLE_ARN

    if (!roleArn) {
      throw new Error('AWS_ROLE_ARN environment variable is required')
    }

    this.client = new S3Client({
      region,
      credentials: awsCredentialsProvider({ roleArn }),
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

  async generatePresignedDownloadUrlForBucket(
    bucket: string,
    key: string,
    expiresIn: number = 3600 // 1 hour
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
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

  generateWorkspaceLogoPath(workspaceId: string, filename: string): string {
    const timestamp = Date.now()
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_')
    const extension = sanitizedFilename.split('.').pop() || 'jpg'

    return `workspace-logos/${workspaceId}/${timestamp}.${extension}`
  }

  generateVideoS3Path(workspaceId: string, swarmId: string, taskId: string): string {
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(2, 15)

    return `recordings/${workspaceId}/${swarmId}/${taskId}/${timestamp}_${randomId}_recording.webm`
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    })

    await this.client.send(command)
  }

  async getObject(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    })

    const response = await this.client.send(command)

    if (!response.Body) {
      throw new Error('No data received from S3')
    }

    const chunks: Uint8Array[] = []
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
    }

    return Buffer.concat(chunks)
  }

  async putObject(
    key: string,
    buffer: Buffer,
    contentType: string
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })

    await this.client.send(command)
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

  validateFileSize(size: number, maxSize?: number): boolean {
    const limit = maxSize || 10 * 1024 * 1024 // Default 10MB
    return size <= limit
  }

  validateImageBuffer(buffer: Buffer, expectedType: string): boolean {
    try {
      const magicNumbers = IMAGE_MAGIC_NUMBERS[expectedType]

      if (!magicNumbers) {
        return false
      }

      if (buffer.length < magicNumbers.length) {
        return false
      }

      for (let i = 0; i < magicNumbers.length; i++) {
        if (buffer[i] !== magicNumbers[i]) {
          return false
        }
      }

      return true
    } catch {
      return false
    }
  }

  validateVideoBuffer(buffer: Buffer, expectedType: string): boolean {
    try {
      const magicNumbers = VIDEO_MAGIC_NUMBERS[expectedType]

      if (!magicNumbers) {
        return false
      }

      if (buffer.length < magicNumbers.length) {
        return false
      }

      for (let i = 0; i < magicNumbers.length; i++) {
        if (buffer[i] !== magicNumbers[i]) {
          return false
        }
      }

      return true
    } catch {
      return false
    }
  }
}

// S3 service with lazy initialization to avoid build-time errors
let _s3Service: S3Service | null = null;

export const getS3Service = (): S3Service => {
  if (!_s3Service) {
    _s3Service = new S3Service();
  }
  return _s3Service;
};