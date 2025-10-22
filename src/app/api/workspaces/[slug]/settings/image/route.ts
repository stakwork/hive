import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth/nextauth'
import { getS3Service } from '@/services/s3'
import { getWorkspaceBySlug } from '@/services/workspace'
import { db } from '@/lib/db'

export async function DELETE(
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
        { error: 'Only workspace owners and admins can remove logos' },
        { status: 403 }
      )
    }

    if (!workspace.logoKey) {
      return NextResponse.json(
        { error: 'Workspace has no logo to remove' },
        { status: 404 }
      )
    }

    const s3Service = getS3Service()

    try {
      await s3Service.deleteObject(workspace.logoKey)
    } catch (error) {
      console.warn('Failed to delete logo from S3:', error)
    }

    await db.workspace.update({
      where: { id: workspace.id },
      data: {
        logoKey: null,
        logoUrl: null,
        updatedAt: new Date(),
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing workspace logo:', error)

    const message =
      error instanceof Error ? error.message : 'Internal server error'

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
