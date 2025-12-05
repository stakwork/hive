/**
 * Mock S3 Download Endpoint
 * 
 * Serves files from in-memory storage when using mock S3 presigned URLs.
 * Auto-creates mock files if they don't exist (prevents 404s during development).
 * 
 * Only active when USE_MOCKS=true
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/env';
import { s3MockState } from '@/lib/mock/s3-state';

const USE_MOCKS = config.USE_MOCKS;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  // Mock gating - return 404 if mocks are disabled
  if (!USE_MOCKS) {
    return NextResponse.json(
      { error: 'Mock endpoints are disabled' },
      { status: 404 }
    );
  }

  try {
    // Await params in Next.js 15
    const resolvedParams = await params;
    
    // Reconstruct full S3 key from path segments
    const key = decodeURIComponent(resolvedParams.key.join('/'));

    // Get file from mock storage (auto-creates if doesn't exist)
    const file = s3MockState.getFile(key);

    // Return file with appropriate headers matching S3 behavior
    return new Response(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': file.size.toString(),
        'Cache-Control': 'public, max-age=31536000',
        'ETag': `"mock-etag-${file.uploadedAt.getTime()}"`,
      },
    });
  } catch (error) {
    console.error('Mock S3 download error:', error);
    return NextResponse.json(
      { error: 'Failed to download file' },
      { status: 500 }
    );
  }
}
