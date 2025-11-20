import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { z } from 'zod'
import { getS3Service } from '@/services/s3'

const screenshotQuerySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  taskId: z.string().optional(),
  pageUrl: z.string().optional(),
  limit: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
  cursor: z.string().optional(),
})

export async function GET(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    const validatedData = screenshotQuerySchema.parse(queryParams)
    const { workspaceId, taskId, pageUrl, limit = 50, cursor } = validatedData

    // Verify workspace exists and user has access
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        deleted: false,
        OR: [
          { ownerId: session.user.id },
          {
            members: {
              some: {
                userId: session.user.id,
                leftAt: null,
              },
            },
          },
        ],
      },
    })

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found or access denied' },
        { status: 404 }
      )
    }

    // Build where clause
    const where: any = {
      workspaceId,
    }

    if (taskId) {
      where.taskId = taskId
    }

    if (pageUrl) {
      where.pageUrl = pageUrl
    }

    if (cursor) {
      where.id = {
        lt: cursor, // Cursor-based pagination (older than cursor)
      }
    }

    // Fetch screenshots
    const screenshots = await db.screenshot.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: limit + 1, // Fetch one extra to determine if there's more
      select: {
        id: true,
        s3Key: true,
        s3Url: true,
        urlExpiresAt: true,
        actionIndex: true,
        pageUrl: true,
        timestamp: true,
        hash: true,
        width: true,
        height: true,
        taskId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    // Check if there are more results
    const hasMore = screenshots.length > limit
    const returnedScreenshots = hasMore ? screenshots.slice(0, -1) : screenshots

    // Regenerate expired URLs
    const s3Service = getS3Service()
    const screenshotsWithUrls = await Promise.all(
      returnedScreenshots.map(async (screenshot) => {
        let s3Url = screenshot.s3Url

        // Check if URL is expired or missing
        if (!s3Url || !screenshot.urlExpiresAt || screenshot.urlExpiresAt < new Date()) {
          // Generate new presigned URL (7 days)
          const expiresIn = 7 * 24 * 60 * 60
          s3Url = await s3Service.generatePresignedDownloadUrl(screenshot.s3Key, expiresIn)

          // Update database with new URL
          const urlExpiresAt = new Date()
          urlExpiresAt.setDate(urlExpiresAt.getDate() + 7)

          await db.screenshot.update({
            where: { id: screenshot.id },
            data: {
              s3Url,
              urlExpiresAt,
            },
          })
        }

        return {
          ...screenshot,
          s3Url,
          timestamp: Number(screenshot.timestamp), // Convert BigInt to number for JSON
        }
      })
    )

    // Get the next cursor (last item's ID)
    const nextCursor = hasMore ? returnedScreenshots[returnedScreenshots.length - 1].id : null

    return NextResponse.json({
      screenshots: screenshotsWithUrls,
      pagination: {
        hasMore,
        nextCursor,
        limit,
      },
    })

  } catch (error) {
    console.error('Error fetching screenshots:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request parameters', details: error.issues },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
