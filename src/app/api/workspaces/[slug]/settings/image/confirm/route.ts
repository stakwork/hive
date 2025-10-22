import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth/nextauth'
import { getS3Service } from '@/services/s3'
import { getWorkspaceBySlug } from '@/services/workspace'
import { workspaceLogoConfirmSchema } from '@/lib/schemas/workspace'
import { db } from '@/lib/db'
import {
  resizeWorkspaceLogo,
  validateImageBuffer,
  isSupportedImageType,
} from '@/lib/image-processing'

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
    const validatedData = workspaceLogoConfirmSchema.parse(body)
    const { s3Path, mimeType } = validatedData

    if (!isSupportedImageType(mimeType)) {
      return NextResponse.json(
        { error: 'Unsupported image type' },
        { status: 400 }
      )
    }

    const s3Service = getS3Service()

    const rawImageBuffer = await s3Service.getObject(s3Path)

    if (!validateImageBuffer(rawImageBuffer, mimeType)) {
      await s3Service.deleteObject(s3Path)
      return NextResponse.json(
        { error: 'Invalid image file. File content does not match declared type.' },
        { status: 400 }
      )
    }

    const processedImage = await resizeWorkspaceLogo(rawImageBuffer)

    await s3Service.putObject(
      s3Path,
      processedImage.buffer,
      processedImage.contentType
    )

    if (workspace.logoKey && workspace.logoKey !== s3Path) {
      try {
        await s3Service.deleteObject(workspace.logoKey)
      } catch (error) {
        console.warn('Failed to delete old logo:', error)
      }
    }

    await db.workspace.update({
      where: { id: workspace.id },
      data: {
        logoKey: s3Path,
        updatedAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      logoKey: s3Path,
      width: processedImage.width,
      height: processedImage.height,
      size: processedImage.size,
    })
  } catch (error) {
    console.error('Error confirming logo upload:', error)

    if (error && typeof error === 'object' && 'issues' in error) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.issues },
        { status: 400 }
      )
    }

    const message =
      error instanceof Error ? error.message : 'Internal server error'

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
