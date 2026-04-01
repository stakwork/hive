import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/env';

export async function GET(req: NextRequest) {
  if (!config.USE_MOCKS) {
    return NextResponse.json({ error: 'Mock endpoints are disabled' }, { status: 404 });
  }

  const paymentHash = req.nextUrl.searchParams.get('paymentHash');
  if (!paymentHash) {
    return NextResponse.json({ error: 'paymentHash is required' }, { status: 400 });
  }

  return NextResponse.json({ status: 'PAID' });
}
