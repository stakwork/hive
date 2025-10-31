import { NextRequest, NextResponse } from 'next/server';
import { getS3Service } from '@/services/s3';

export async function POST(request: NextRequest) {
  try {
    const { s3Key } = await request.json();
    console.log('[Presigned URL] Request received for S3 key:', s3Key);

    if (!s3Key) {
      console.log('[Presigned URL] Error: Missing S3 key');
      return NextResponse.json(
        { error: 'S3 key is required' },
        { status: 400 }
      );
    }

    console.log('[Presigned URL] Generating presigned URL for key:', s3Key);
    const s3Service = getS3Service();
    const presignedUrl = await s3Service.generatePresignedDownloadUrlForBucket(
      'sphinx-livekit-recordings',
      s3Key
    );
    console.log('[Presigned URL] Successfully generated URL');

    return NextResponse.json({ presignedUrl });
  } catch (error) {
    console.error('[Presigned URL] Error generating presigned URL:', error);
    console.error('[Presigned URL] Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    return NextResponse.json(
      { error: 'Failed to generate presigned URL' },
      { status: 500 }
    );
  }
}