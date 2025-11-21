import { auth } from "@/lib/auth/auth";
import { NextRequest, NextResponse } from 'next/server'
import { getS3Service } from '@/services/s3'
import { db } from '@/lib/db'
import { z } from 'zod'

const uploadRequestSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  contentType: z.string().min(1, 'Content type is required'),
  size: z.number().min(1, 'File size must be greater than 0'),
  featureId: z.string().min(1, 'Feature ID is required'),
})

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = uploadRequestSchema.parse(body)
    const { filename, contentType, size, featureId } = validatedData
    
    // Get feature with workspace information
    const feature = await db.feature.findFirst({
      where: {
        id: featureId,
        deleted: false,
      },
      select: {
        workspaceId: true,
        workspace: {
          select: {
            id: true,
            swarm: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    })
    
    if (!feature) {
      return NextResponse.json(
        { error: 'Feature not found' },
        { status: 404 }
      )
    }
    
    const workspaceId = feature.workspace.id
    const swarmId = feature.workspace.swarm?.id || 'default'

    // Validate file type
    if (!getS3Service().validateFileType(contentType)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only images (JPEG, PNG, GIF, WebP) are allowed.' },
        { status: 400 }
      )
    }

    // Validate file size
    if (!getS3Service().validateFileSize(size)) {
      return NextResponse.json(
        { error: 'File size exceeds maximum limit of 10MB.' },
        { status: 400 }
      )
    }

    // Generate S3 path for feature images
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(2, 15)
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_')
    const s3Path = `features/${workspaceId}/${swarmId}/${featureId}/${timestamp}_${randomId}_${sanitizedFilename}`

    // Generate presigned upload URL
    const presignedUrl = await getS3Service().generatePresignedUploadUrl(
      s3Path,
      contentType,
      300 // 5 minutes
    )

    // Generate a long-lived presigned download URL for viewing the image
    // Using 1 year expiry since these are meant to be persistent image links
    const publicUrl = await getS3Service().generatePresignedDownloadUrl(
      s3Path,
      604800 // 1 year in seconds
    )

    return NextResponse.json({
      presignedUrl,
      s3Path,
      publicUrl,
      filename,
      contentType,
      size,
    })

  } catch (error) {
    console.error('Error generating presigned URL:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.issues },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
