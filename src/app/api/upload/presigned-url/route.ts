import { NextRequest, NextResponse } from 'next/server'
import { getMiddlewareContext, requireAuth } from '@/lib/middleware/utils'
import { getS3Service } from '@/services/s3'
import { db } from '@/lib/db'
import { validateWorkspaceAccessById } from '@/services/workspace'
import { z } from 'zod'

const uploadRequestSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  contentType: z.string().min(1, 'Content type is required'),
  size: z.number().min(1, 'File size must be greater than 0'),
  taskId: z.string().min(1, 'Task ID is required'),
})

/**
 * Extract the owning workspaceId from a well-known S3 key prefix.
 *
 * Returns `null` when the key doesn't match a supported prefix — callers
 * should treat that as a 404 rather than silently falling through.
 *
 * Supported prefixes mirror the generators on `S3Service`:
 *   - uploads/<workspaceId>/<swarmId>/<taskId>/...
 *   - workspace-logos/<workspaceId>/...
 *   - whiteboards/<workspaceId>/...
 *   - screenshots/<workspaceId>/...
 *   - features/<workspaceId>/...
 *   - diagrams/<workspaceId>/...
 */
function extractWorkspaceIdFromS3Key(s3Key: string): string | null {
  const parts = s3Key.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const [prefix, workspaceId] = parts
  const ALLOWED_PREFIXES = new Set([
    'uploads',
    'workspace-logos',
    'whiteboards',
    'screenshots',
    'features',
    'diagrams',
  ])
  if (!ALLOWED_PREFIXES.has(prefix)) return null
  return workspaceId || null
}

export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request)
    const userOrResponse = requireAuth(context)
    if (userOrResponse instanceof NextResponse) return userOrResponse
    const userId = userOrResponse.id

    // Get s3Key from query params
    const { searchParams } = new URL(request.url)
    const s3Key = searchParams.get('s3Key')

    if (!s3Key) {
      return NextResponse.json(
        { error: 's3Key parameter is required' },
        { status: 400 }
      )
    }

    // IDOR hardening: s3Keys follow a `<prefix>/<workspaceId>/...` layout.
    // Parse the workspaceId out of the key and require membership before
    // minting a presigned download URL — otherwise any signed-in user can
    // exfiltrate any other workspace's attachments/artifacts/feature media.
    const workspaceId = extractWorkspaceIdFromS3Key(s3Key)
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found or access denied' },
        { status: 404 }
      )
    }

    const access = await validateWorkspaceAccessById(workspaceId, userId)
    if (!access.hasAccess || !access.canRead) {
      return NextResponse.json(
        { error: 'Workspace not found or access denied' },
        { status: 404 }
      )
    }

    // Generate presigned download URL
    const presignedUrl = await getS3Service().generatePresignedDownloadUrl(
      s3Key,
      300 // 5 minutes
    )

    // Redirect to the presigned URL
    return NextResponse.redirect(presignedUrl)

  } catch (error) {
    console.error('Error generating presigned download URL:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request)
    const userOrResponse = requireAuth(context)
    if (userOrResponse instanceof NextResponse) return userOrResponse
    const userId = userOrResponse.id

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

    // IDOR hardening: require write access to the task's workspace before
    // issuing an upload URL scoped to its S3 prefix.
    const access = await validateWorkspaceAccessById(workspaceId, userId)
    if (!access.hasAccess || !access.canWrite) {
      return NextResponse.json(
        { error: 'Workspace not found or access denied' },
        { status: 404 }
      )
    }

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
