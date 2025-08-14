import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/nextauth'
import { s3Service } from '@/services/s3'
import { z } from 'zod'

const uploadRequestSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  contentType: z.string().min(1, 'Content type is required'),
  size: z.number().min(1, 'File size must be greater than 0'),
  workspaceSlug: z.string().min(1, 'Workspace slug is required'),
  taskId: z.string().min(1, 'Task ID is required'),
})

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = uploadRequestSchema.parse(body)
    const { filename, contentType, size, workspaceSlug, taskId } = validatedData

    // Validate file type
    if (!s3Service.validateFileType(contentType)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only images (JPEG, PNG, GIF, WebP) are allowed.' },
        { status: 400 }
      )
    }

    // Validate file size
    if (!s3Service.validateFileSize(size)) {
      return NextResponse.json(
        { error: 'File size exceeds maximum limit of 10MB.' },
        { status: 400 }
      )
    }

    // Generate S3 path
    const s3Path = s3Service.generateS3Path(workspaceSlug, taskId, filename)

    // Generate presigned upload URL
    const presignedUrl = await s3Service.generatePresignedUploadUrl(
      s3Path,
      contentType,
      300 // 5 minutes
    )

    return NextResponse.json({
      presignedUrl,
      s3Path,
      filename,
      contentType,
      size,
    })

  } catch (error) {
    console.error('Error generating presigned URL:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}