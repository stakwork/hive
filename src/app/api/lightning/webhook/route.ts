import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { fetchBtcPriceUsd } from '@/lib/btc-price';

export async function POST(req: NextRequest) {
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

    const btcPriceUsd = await fetchBtcPriceUsd();
    const amountUsd = btcPriceUsd ? (payment.amount / 100_000_000) * btcPriceUsd : null;

    try {
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
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        logger.info(
          'WorkspaceTransaction already exists for lightningPaymentId — idempotent skip',
          'lightning-webhook',
          { payment_hash },
        );
      } else {
        throw err;
      }
    }
  } catch (err) {
    logger.error('Lightning webhook processing error', 'lightning-webhook', { err });
  }

  return NextResponse.json({ received: true });
}
