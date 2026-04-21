import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspaceAccess, requireReadAccess } from '@/lib/auth/workspace-access'
import { getS3Service } from '@/services/s3'
import { db } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params

    if (!slug) {
      return NextResponse.json(
        { error: 'Workspace slug is required' },
        { status: 400 }
      )
    }

    // Public-readable: workspace logo is by definition shareable — if the
    // owner made the workspace public, the logo comes along with it. For
    // private workspaces we still require membership.
    const access = await resolveWorkspaceAccess(request, { slug })
    const ok = requireReadAccess(access)
    if (ok instanceof NextResponse) return ok

    const workspace = await db.workspace.findUnique({
      where: { id: ok.workspaceId },
      select: { logoKey: true },
    })

    if (!workspace?.logoKey) {
      return NextResponse.json(
        { error: 'Workspace has no logo' },
        { status: 404 }
      )
    }

    const presignedUrl = await getS3Service().generatePresignedDownloadUrl(
      workspace.logoKey,
      3600, // 1 hour
    )

    return NextResponse.json({ presignedUrl, expiresIn: 3600 })
  } catch (error) {
    console.error('Error retrieving workspace logo:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
