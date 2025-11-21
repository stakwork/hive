import { NextRequest, NextResponse } from 'next/server'
import { auth } from "@/lib/auth";
import { db } from '@/lib/db'
import { z } from 'zod'
import { processScreenshotUpload } from '@/lib/screenshot-upload'

const screenshotUploadSchema = z.object({
  dataUrl: z.string().min(1, 'Screenshot data URL is required'),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  taskId: z.string().nullable(),
  actionIndex: z.number().int().min(0, 'Action index must be >= 0'),
  pageUrl: z.string().min(1, 'Page URL is required'),
  timestamp: z.number().int().positive('Timestamp must be positive'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
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
    const validatedData = screenshotUploadSchema.parse(body)
    const {
      dataUrl,
      workspaceId,
      taskId,
      actionIndex,
      pageUrl,
      timestamp,
      width,
      height
    } = validatedData

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

    // If taskId is provided, verify it exists and belongs to the workspace
    if (taskId) {
      const task = await db.task.findFirst({
        where: {
          id: taskId,
          workspaceId,
          deleted: false,
        },
      })

      if (!task) {
        return NextResponse.json(
          { error: 'Task not found or does not belong to workspace' },
          { status: 404 }
        )
      }
    }

    // Process screenshot upload (convert, hash, upload to S3)
    const { hash, s3Key, s3Url } = await processScreenshotUpload(dataUrl, workspaceId)

    // Calculate URL expiration (7 days from now)
    const urlExpiresAt = new Date()
    urlExpiresAt.setDate(urlExpiresAt.getDate() + 7)

    // Check if screenshot with this hash already exists
    const existingScreenshot = await db.screenshot.findUnique({
      where: { hash },
    })

    if (existingScreenshot) {
      // Screenshot already exists, return existing record
      // Optionally update the s3Url if it's expired
      let updatedScreenshot = existingScreenshot

      if (!existingScreenshot.urlExpiresAt || existingScreenshot.urlExpiresAt < new Date()) {
        // URL is expired, update it
        updatedScreenshot = await db.screenshot.update({
          where: { id: existingScreenshot.id },
          data: {
            s3Url,
            urlExpiresAt,
          },
        })
      }

      return NextResponse.json({
        id: updatedScreenshot.id,
        s3Key: updatedScreenshot.s3Key,
        s3Url: updatedScreenshot.s3Url || s3Url,
        hash: updatedScreenshot.hash,
        deduplicated: true,
      })
    }

    // Create new screenshot record
    const screenshot = await db.screenshot.create({
      data: {
        workspaceId,
        taskId,
        s3Key,
        s3Url,
        urlExpiresAt,
        actionIndex,
        pageUrl,
        timestamp: BigInt(timestamp),
        hash,
        width,
        height,
      },
    })

    return NextResponse.json({
      id: screenshot.id,
      s3Key: screenshot.s3Key,
      s3Url: screenshot.s3Url,
      hash: screenshot.hash,
      deduplicated: false,
    })

  } catch (error) {
    console.error('Error uploading screenshot:', error)
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace')

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.issues },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
