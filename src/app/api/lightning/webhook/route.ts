import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { fetchBtcPriceUsd } from '@/lib/btc-price';
import { lookupLndInvoice } from '@/services/lightning';

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-webhook-secret');
  if (!token || token !== process.env.LIGHTNING_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const payment_hash = body?.payment_hash;

    if (!payment_hash) {
      return NextResponse.json({ received: true });
    }

    const payment = await db.lightningPayment.findUnique({
      where: { paymentHash: payment_hash },
    });

    if (!payment) {
      logger.info('Lightning webhook: payment_hash not found, ignoring', 'lightning-webhook', {
        payment_hash,
      });
      return NextResponse.json({ received: true });
    }

    // Verify settlement with LND directly — never trust the webhook payload alone
    const { settled } = await lookupLndInvoice(payment_hash);
    if (!settled) {
      logger.info('Lightning webhook: LND reports invoice not settled, ignoring', 'lightning-webhook', {
        payment_hash,
      });
      return NextResponse.json({ received: true });
    }

    const btcPriceUsd = await fetchBtcPriceUsd();
    const amountUsd = btcPriceUsd ? (payment.amount / 100_000_000) * btcPriceUsd : null;

    await db.$transaction([
      db.lightningPayment.update({
        where: { paymentHash: payment_hash },
        data: { status: 'PAID' },
      }),
      db.workspaceTransaction.create({
        data: {
          workspaceId: payment.workspaceId ?? null,
          type: 'LIGHTNING',
          amountSats: payment.amount,
          btcPriceUsd,
          amountUsd,
          lightningPaymentId: payment.id,
        },
      }),
    ]);
  } catch (err) {
    logger.error('Lightning webhook processing error', 'lightning-webhook', { err });
  }

  return NextResponse.json({ received: true });
}
