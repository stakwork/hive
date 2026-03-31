import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/env';

export async function POST(req: NextRequest) {
  if (!config.USE_MOCKS) {
    return NextResponse.json({ error: 'Mock endpoints are disabled' }, { status: 404 });
  }
  const body = await req.json();
  const amount = body?.value ?? 0;
  const rand = Math.random().toString(36).substring(7);
  return NextResponse.json({
    payment_hash: `mock_hash_${amount}_${rand}`,
    payment_request: `lnbc${amount}u1mock_invoice_${rand}`,
  });
}
