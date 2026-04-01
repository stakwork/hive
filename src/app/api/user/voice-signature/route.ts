import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/nextauth'
import { getS3Service } from '@/services/s3'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

const MAX_VOICE_SIGNATURE_SIZE = 50 * 1024 * 1024 // 50 MB

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
    const { contentType, size } = body

    // Validate content type
    if (contentType !== 'audio/wav') {
      return NextResponse.json(
        { error: 'Invalid content type. Only audio/wav is supported.' },
        { status: 400 }
      )
    }

    // Validate file size
    if (typeof size !== 'number' || size <= 0 || size > MAX_VOICE_SIGNATURE_SIZE) {
      return NextResponse.json(
        { error: `File size must be between 1 byte and 50 MB.` },
        { status: 400 }
      )
    }

    const s3Service = getS3Service()
    const s3Path = s3Service.generateVoiceSignaturePath(session.user.id)

    const presignedUrl = await s3Service.generatePresignedUploadUrl(
      s3Path,
      contentType,
      900 // 15 minutes
    )

    logger.info('Voice signature upload URL generated', 'VOICE_SIGNATURE_UPLOAD_URL', {
      userId: session.user.id,
      s3Path,
    })

    return NextResponse.json({ presignedUrl, s3Path })
  } catch (error) {
    logger.error('Failed to generate voice signature upload URL', 'VOICE_SIGNATURE_UPLOAD_URL_ERROR', error)
    return NextResponse.json(
      { error: 'Failed to generate upload URL' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/user/voice-signature
 * Delete user's voice signature from S3 and clear DB reference
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch user's current voice signature key
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { voiceSignatureKey: true },
    })

    if (!user?.voiceSignatureKey) {
      return NextResponse.json({ error: 'No voice signature found' }, { status: 404 })
    }

    // Delete from S3
    try {
      const s3Service = getS3Service()
      await s3Service.deleteObject(user.voiceSignatureKey)
    } catch (s3Error) {
      // Swallow S3 errors with a warning
      logger.warn('Failed to delete voice signature from S3', 'VOICE_SIGNATURE_S3_DELETE_ERROR', {
        userId: session.user.id,
        s3Key: user.voiceSignatureKey,
        error: s3Error,
      })
    }

    // Clear the DB reference
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
      { error: 'Failed to delete voice signature' },
      { status: 500 }
    )
  }
}
