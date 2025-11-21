import { auth } from "@/lib/auth/auth";
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth/auth'
import { getS3Service } from '@/services/s3'
import { db } from '@/lib/db'
import { z } from 'zod'

const uploadRequestSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  contentType: z.string().min(1, 'Content type is required'),
  size: z.number().min(1, 'File size must be greater than 0'),
  taskId: z.string().min(1, 'Task ID is required'),
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
    const { filename, contentType, size, taskId } = validatedData
    
    // Get task with workspace and swarm information
    const task = await db.task.findFirst({
      where: {
        id: taskId,
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
    
    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      )
    }
    
    const workspaceId = task.workspace.id
    const swarmId = task.workspace.swarm?.id || 'default'

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

    // Generate S3 path
    const s3Path = getS3Service().generateS3Path(workspaceId, swarmId, taskId, filename)

    // Generate presigned upload URL
    const presignedUrl = await getS3Service().generatePresignedUploadUrl(
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