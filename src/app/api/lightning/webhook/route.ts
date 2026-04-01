import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payment_hash = body?.payment_hash;

    if (payment_hash) {
      await db.lightningPayment.updateMany({
        where: { paymentHash: payment_hash },
        data: { status: 'PAID' },
      });
    }
  } catch (err) {
    logger.error('Lightning webhook processing error', 'lightning-webhook', { err });
  }

  return NextResponse.json({ received: true });
}
