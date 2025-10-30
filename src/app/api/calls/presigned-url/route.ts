import { NextRequest, NextResponse } from 'next/server';
import { generateCallPresignedUrl } from '@/lib/aws/s3-presigner';

export async function POST(request: NextRequest) {
  try {
    const { s3Key } = await request.json();

    if (!s3Key) {
      return NextResponse.json(
        { error: 'S3 key is required' },
        { status: 400 }
      );
    }

    const presignedUrl = await generateCallPresignedUrl(s3Key);

    return NextResponse.json({ presignedUrl });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate presigned URL' },
      { status: 500 }
    );
  }
}