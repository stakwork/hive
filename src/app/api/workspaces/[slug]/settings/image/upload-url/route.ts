import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth/nextauth'
import { getS3Service } from '@/services/s3'
import { getWorkspaceBySlug } from '@/services/workspace'
import { workspaceLogoUploadRequestSchema } from '@/lib/schemas/workspace'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    const userId = (session?.user as { id?: string })?.id

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { slug } = await params

    if (!slug) {
      return NextResponse.json(
        { error: 'Workspace slug is required' },
        { status: 400 }
      )
    }

    const workspace = await getWorkspaceBySlug(slug, userId)

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found or access denied' },
        { status: 404 }
      )
    }

    if (workspace.userRole !== 'OWNER' && workspace.userRole !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only workspace owners and admins can upload logos' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const validatedData = workspaceLogoUploadRequestSchema.parse(body)
    const { filename, contentType, size } = validatedData

    const s3Service = getS3Service()

    if (!s3Service.validateFileType(contentType)) {
      return NextResponse.json(
        {
          error:
            'Invalid file type. Only images (JPEG, PNG, GIF, WebP) are allowed.',
        },
        { status: 400 }
      )
    }

    if (!s3Service.validateFileSize(size, 1024 * 1024)) {
      return NextResponse.json(
        { error: 'File size exceeds maximum limit of 1MB.' },
        { status: 400 }
      )
    }

    const s3Path = s3Service.generateWorkspaceLogoPath(workspace.id, filename)

    const presignedUrl = await s3Service.generatePresignedUploadUrl(
      s3Path,
      contentType,
      900
    )

    return NextResponse.json({
      presignedUrl,
      s3Path,
      filename,
      contentType,
      size,
      expiresIn: 900,
    })
  } catch (error) {
    console.error('Error generating presigned upload URL:', error)

    if (error && typeof error === 'object' && 'issues' in error) {
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
