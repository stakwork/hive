import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const paymentHash = req.nextUrl.searchParams.get('paymentHash');
  if (!paymentHash) {
    return NextResponse.json({ error: 'paymentHash is required' }, { status: 400 });
  }

  const payment = await db.lightningPayment.findUnique({
    where: { paymentHash },
    select: { status: true },
  });

  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  return NextResponse.json({ status: payment.status });
}
