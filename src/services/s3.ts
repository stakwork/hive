import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { awsCredentialsProvider } from '@vercel/functions/oidc'

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
}

// S3 service with lazy initialization to avoid build-time errors
let _s3Service: S3Service | null = null;

export const getS3Service = (): S3Service => {
  if (!_s3Service) {
    _s3Service = new S3Service();
  }
  return _s3Service;
};