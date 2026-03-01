import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/nextauth'
import { getS3Service } from '@/services/s3'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { voiceSignatureConfirmSchema } from '@/lib/schemas/user'

/**
 * POST /api/user/voice-signature/confirm
 * Validate uploaded WAV file and update user record
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = voiceSignatureConfirmSchema.parse(body)

    const s3Service = getS3Service()

    // Fetch the uploaded file from S3
    let buffer: Buffer
    try {
      buffer = await s3Service.getObject(validatedData.s3Path)
    } catch (error) {
      logger.error('Failed to fetch voice signature from S3', 'VOICE_SIGNATURE_FETCH_ERROR', {
        userId: session.user.id,
        s3Path: validatedData.s3Path,
        error,
      })
      return NextResponse.json(
        { error: 'Failed to fetch uploaded file' },
        { status: 400 }
      )
    }

    // Validate the audio buffer
    const isValid = s3Service.validateAudioBuffer(buffer, 'audio/wav')
    if (!isValid) {
      // Delete invalid file from S3
      try {
        await s3Service.deleteObject(validatedData.s3Path)
      } catch (deleteError) {
        logger.warn('Failed to delete invalid voice signature from S3', 'VOICE_SIGNATURE_DELETE_ERROR', {
          userId: session.user.id,
          s3Path: validatedData.s3Path,
          error: deleteError,
        })
      }

      logger.warn('Invalid voice signature file uploaded', 'VOICE_SIGNATURE_INVALID', {
        userId: session.user.id,
        s3Path: validatedData.s3Path,
      })

      return NextResponse.json(
        { error: 'Invalid audio file. Please upload a valid WAV file.' },
        { status: 400 }
      )
    }

    // Update user record with S3 key
    await db.user.update({
      where: { id: session.user.id },
      data: { voiceSignatureKey: validatedData.s3Path },
    })

    logger.info('Voice signature confirmed and saved', 'VOICE_SIGNATURE_CONFIRM', {
      userId: session.user.id,
      s3Path: validatedData.s3Path,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to confirm voice signature', 'VOICE_SIGNATURE_CONFIRM_ERROR', error)

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
