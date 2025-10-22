import sharp from 'sharp'

const WORKSPACE_LOGO_MAX_WIDTH = 1200
const WORKSPACE_LOGO_MAX_HEIGHT = 400
const IMAGE_QUALITY = 80

const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const

const IMAGE_MAGIC_NUMBERS: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/gif': [0x47, 0x49, 0x46],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
}

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number]

export interface ProcessedImage {
  buffer: Buffer
  contentType: string
  width: number
  height: number
  size: number
}

export async function resizeWorkspaceLogo(
  buffer: Buffer,
  maxWidth: number = WORKSPACE_LOGO_MAX_WIDTH,
  maxHeight: number = WORKSPACE_LOGO_MAX_HEIGHT
): Promise<ProcessedImage> {
  try {
    const image = sharp(buffer)
    const metadata = await image.metadata()

    if (!metadata.format) {
      throw new Error('Unable to determine image format')
    }

    const contentType = `image/${metadata.format}`

    if (!isSupportedImageType(contentType)) {
      throw new Error(
        `Unsupported image format: ${contentType}. Supported formats: ${SUPPORTED_IMAGE_TYPES.join(', ')}`
      )
    }

    const processedBuffer = await image
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: IMAGE_QUALITY, mozjpeg: true })
      .toBuffer()

    const processedMetadata = await sharp(processedBuffer).metadata()

    return {
      buffer: processedBuffer,
      contentType: 'image/jpeg',
      width: processedMetadata.width || 0,
      height: processedMetadata.height || 0,
      size: processedBuffer.length,
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to process image: ${error.message}`)
    }
    throw new Error('Failed to process image: Unknown error')
  }
}

export function validateImageBuffer(
  buffer: Buffer,
  expectedType: string
): boolean {
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

export function isSupportedImageType(type: string): type is SupportedImageType {
  return SUPPORTED_IMAGE_TYPES.includes(type as SupportedImageType)
}

export function getImageExtensionFromMimeType(mimeType: string): string {
  const extension = mimeType.split('/')[1]
  if (!extension) {
    throw new Error(`Invalid MIME type: ${mimeType}`)
  }
  return extension
}

export function validateImageSize(
  size: number,
  maxSize: number = 1024 * 1024
): boolean {
  return size > 0 && size <= maxSize
}
