import crypto from 'crypto'
import { getS3Service } from '@/services/s3'

/**
 * Converts a base64 data URL to a Buffer
 * @param dataUrl Base64 data URL (e.g., "data:image/jpeg;base64,...")
 * @returns Buffer containing the image data
 */
export function dataUrlToBuffer(dataUrl: string): Buffer {
  // Extract the base64 data from the data URL
  const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)

  if (!matches || matches.length !== 3) {
    throw new Error('Invalid data URL format')
  }

  const base64Data = matches[2]
  return Buffer.from(base64Data, 'base64')
}

/**
 * Generates a SHA-256 hash of the buffer and returns the first 12 characters
 * This is used for deduplication and as the filename
 * @param buffer Image buffer
 * @returns 12-character hash string
 */
export function generateContentHash(buffer: Buffer): string {
  const hash = crypto.createHash('sha256')
  hash.update(buffer)
  const fullHash = hash.digest('hex')
  return fullHash.substring(0, 12)
}

/**
 * Generates the S3 key for a screenshot
 * Format: screenshots/{workspaceId}/{hash}.jpg
 * @param workspaceId Workspace ID
 * @param hash Content hash (12 characters)
 * @returns S3 key string
 */
export function generateScreenshotS3Key(workspaceId: string, hash: string): string {
  return `screenshots/${workspaceId}/${hash}.jpg`
}

/**
 * Uploads a screenshot to S3 and returns the metadata
 * @param buffer Image buffer
 * @param workspaceId Workspace ID
 * @param hash Content hash
 * @returns Object with s3Key and s3Url
 */
export async function uploadScreenshotToS3(
  buffer: Buffer,
  workspaceId: string,
  hash: string
): Promise<{ s3Key: string; s3Url: string }> {
  const s3Service = getS3Service()
  const s3Key = generateScreenshotS3Key(workspaceId, hash)

  // Upload to S3
  await s3Service.putObject(s3Key, buffer, 'image/jpeg')

  // Generate a presigned download URL (valid for 7 days)
  const expiresIn = 7 * 24 * 60 * 60 // 7 days in seconds
  const s3Url = await s3Service.generatePresignedDownloadUrl(s3Key, expiresIn)

  return { s3Key, s3Url }
}

/**
 * Complete screenshot upload process:
 * 1. Convert data URL to buffer
 * 2. Generate content hash
 * 3. Upload to S3
 * @param dataUrl Base64 data URL
 * @param workspaceId Workspace ID
 * @returns Object with buffer, hash, s3Key, and s3Url
 */
export async function processScreenshotUpload(
  dataUrl: string,
  workspaceId: string
): Promise<{
  buffer: Buffer
  hash: string
  s3Key: string
  s3Url: string
}> {
  // Convert data URL to buffer
  const buffer = dataUrlToBuffer(dataUrl)

  // Generate content hash
  const hash = generateContentHash(buffer)

  // Upload to S3
  const { s3Key, s3Url } = await uploadScreenshotToS3(buffer, workspaceId, hash)

  return { buffer, hash, s3Key, s3Url }
}

/**
 * Downloads a .webm recording from a URL, uploads it to S3, and returns metadata.
 * S3 key format: recordings/{workspaceId}/{hash}.webm
 * @param url Remote URL of the .webm file
 * @param workspaceId Workspace ID
 * @returns Object with s3Key, buffer, and hash
 */
export async function processRecordingUpload(
  url: string,
  workspaceId: string
): Promise<{ s3Key: string; buffer: Buffer; hash: string }> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch recording: ${response.status} ${response.statusText}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const hash = generateContentHash(buffer)
  const s3Key = `recordings/${workspaceId}/${hash}.webm`
  const s3Service = getS3Service()
  await s3Service.putObject(s3Key, buffer, 'video/webm')
  return { s3Key, buffer, hash }
}
