import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/nextauth'
import { getS3Service } from '@/services/s3'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * POST /api/user/voice-signature/confirm
 * Confirm voice signature upload and update user record
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { s3Path } = body

    // Validate s3Path
    if (typeof s3Path !== 'string' || !s3Path) {
      return NextResponse.json(
        { error: 'S3 path is required' },
        { status: 400 }
      )
    }

    // Validate that the s3Path matches the expected pattern for this user
    const s3Service = getS3Service()
    const expectedPath = s3Service.generateVoiceSignaturePath(session.user.id)
    
    if (s3Path !== expectedPath) {
      return NextResponse.json(
        { error: 'Invalid S3 path' },
        { status: 400 }
      )
    }

    // Fetch and validate the uploaded file from S3
    try {
      const buffer = await s3Service.getObject(s3Path)
      
      // Validate that it's a valid WAV file
      if (!s3Service.validateAudioBuffer(buffer, 'audio/wav')) {
        // Invalid file - delete from S3
        await s3Service.deleteObject(s3Path)
        return NextResponse.json(
          { error: 'Invalid audio file. The uploaded file is not a valid WAV file.' },
          { status: 400 }
        )
      }
    } catch (s3Error) {
      logger.error('Failed to retrieve voice signature from S3', 'VOICE_SIGNATURE_S3_GET_ERROR', {
        userId: session.user.id,
        s3Path,
        error: s3Error,
      })
      return NextResponse.json(
        { error: 'Failed to verify uploaded file' },
        { status: 500 }
      )
    }

    // Update user record with the S3 key
    await db.user.update({
      where: { id: session.user.id },
      data: { voiceSignatureKey: s3Path },
    })

    logger.info('Voice signature confirmed', 'VOICE_SIGNATURE_CONFIRM', {
      userId: session.user.id,
      s3Path,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to confirm voice signature', 'VOICE_SIGNATURE_CONFIRM_ERROR', error)
    return NextResponse.json(
      { error: 'Failed to confirm upload' },
      { status: 500 }
    )
  }
}
