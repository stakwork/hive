import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth/nextauth'
import { getS3Service } from '@/services/s3'
import { getWorkspaceBySlug } from '@/services/workspace'

export async function GET(
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

    if (!workspace.logoKey) {
      return NextResponse.json(
        { error: 'Workspace has no logo' },
        { status: 404 }
      )
    }

    const s3Service = getS3Service()

    const presignedUrl = await s3Service.generatePresignedDownloadUrl(
      workspace.logoKey,
      3600
    )

    return NextResponse.json({
      presignedUrl,
      expiresIn: 3600,
    })
  } catch (error) {
    console.error('Error retrieving workspace logo:', error)

    const message =
      error instanceof Error ? error.message : 'Internal server error'

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
