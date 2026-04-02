import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/env';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ r_hash: string }> },
) {
  if (!config.USE_MOCKS) {
    return NextResponse.json({ error: 'Mock endpoints are disabled' }, { status: 404 });
  }

  const { r_hash } = await params;
  // settled if the r_hash (base64url) decodes to something starting with 'mock_paid_'
  // or the r_hash itself contains 'paid' (for convenience in tests)
  let settled = false;
  try {
    const hex = Buffer.from(r_hash, 'base64url').toString('hex');
    settled = hex.startsWith('mock_paid_') || r_hash.includes('paid');
  } catch {
    settled = r_hash.includes('paid');
  }

  return NextResponse.json({ settled });
}
