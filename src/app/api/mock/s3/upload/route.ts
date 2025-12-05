/**
 * Mock S3 Upload Endpoint
 * 
 * Handles file uploads when using mock S3 presigned URLs.
 * Stores files in-memory via S3MockState for local development.
 * 
 * Only active when USE_MOCKS=true
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/env';
import { s3MockState } from '@/lib/mock/s3-state';

const USE_MOCKS = config.USE_MOCKS;

export async function PUT(request: NextRequest) {
  // Mock gating - return 404 if mocks are disabled
  if (!USE_MOCKS) {
    return NextResponse.json(
      { error: 'Mock endpoints are disabled' },
      { status: 404 }
    );
  }

  try {
    // Extract S3 key and content type from query parameters
    const searchParams = request.nextUrl.searchParams;
    const key = searchParams.get('key');
    const contentType = searchParams.get('contentType');

    if (!key) {
      return NextResponse.json(
        { error: 'Missing required parameter: key' },
        { status: 400 }
      );
    }

    // Read file buffer from request body
    const buffer = Buffer.from(await request.arrayBuffer());

    // Store file in mock state
    s3MockState.storeFile(key, buffer, contentType || 'application/octet-stream');

    // Return success response matching S3 behavior
    return new Response(null, {
      status: 200,
      headers: {
        'ETag': `"mock-etag-${Date.now()}"`,
      },
    });
  } catch (error) {
    console.error('Mock S3 upload error:', error);
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    );
  }
}

// Also support POST for compatibility
export async function POST(request: NextRequest) {
  return PUT(request);
}
