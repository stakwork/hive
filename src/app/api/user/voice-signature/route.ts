import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/nextauth'
import { getS3Service } from '@/services/s3'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { voiceSignatureUploadRequestSchema } from '@/lib/schemas/user'

/**
 * POST /api/user/voice-signature
 * Generate presigned upload URL for voice signature WAV file
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = voiceSignatureUploadRequestSchema.parse(body)

    const s3Service = getS3Service()
    const s3Path = s3Service.generateVoiceSignaturePath(session.user.id)
    const presignedUrl = await s3Service.generatePresignedUploadUrl(
      s3Path,
      validatedData.contentType,
      900 // 15 minutes
    )

    logger.info('Voice signature upload URL generated', 'VOICE_SIGNATURE_UPLOAD_URL', {
      userId: session.user.id,
      s3Path,
    })

    return NextResponse.json({ presignedUrl, s3Path })
  } catch (error) {
    logger.error('Failed to generate voice signature upload URL', 'VOICE_SIGNATURE_UPLOAD_URL_ERROR', error)

    if (error && typeof error === 'object' && 'issues' in error) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/user/voice-signature
 * Delete voice signature from S3 and clear DB reference
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch current voice signature key
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { voiceSignatureKey: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Delete from S3 if exists
    if (user.voiceSignatureKey) {
      try {
        const s3Service = getS3Service()
        await s3Service.deleteObject(user.voiceSignatureKey)
      } catch (s3Error) {
        // Log but don't fail - we still want to clear the DB reference
        logger.warn('Failed to delete voice signature from S3', 'VOICE_SIGNATURE_S3_DELETE_ERROR', {
          userId: session.user.id,
          s3Key: user.voiceSignatureKey,
          error: s3Error,
        })
      }
    }

    // Clear DB reference
    await db.user.update({
      where: { id: session.user.id },
      data: { voiceSignatureKey: null },
    })

    logger.info('Voice signature deleted', 'VOICE_SIGNATURE_DELETE', {
      userId: session.user.id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to delete voice signature', 'VOICE_SIGNATURE_DELETE_ERROR', error)

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
