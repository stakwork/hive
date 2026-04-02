import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { lookupLndInvoice } from '@/services/lightning';
import { fetchBtcPriceUsd } from '@/lib/btc-price';

export async function GET(req: NextRequest) {
  const paymentHash = req.nextUrl.searchParams.get('paymentHash');
  if (!paymentHash) {
    return NextResponse.json({ error: 'paymentHash is required' }, { status: 400 });
  }

  const payment = await db.lightningPayment.findUnique({
    where: { paymentHash },
  });

  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  if (payment.status === 'PAID') {
    return NextResponse.json({ status: 'PAID' });
  }

  // UNPAID — check LND directly as fallback in case webhook was missed
  try {
    logger.info('Looking up invoice on LND', 'lightning-status', { paymentHash });
    const lookupResult = await lookupLndInvoice(paymentHash);
    logger.info('LND lookup result', 'lightning-status', { paymentHash, settled: lookupResult.settled });

    if (lookupResult.settled) {
      logger.info('Invoice settled, updating DB', 'lightning-status', { paymentHash });
      const btcPriceUsd = await fetchBtcPriceUsd();
      const amountUsd = btcPriceUsd ? (payment.amount / 100_000_000) * btcPriceUsd : null;
      await db.$transaction([
        db.lightningPayment.update({
          where: { paymentHash },
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
      logger.info('DB updated to PAID', 'lightning-status', { paymentHash });
      return NextResponse.json({ status: 'PAID' });
    }
  } catch (err) {
    const errDetail = err instanceof Error
      ? { message: err.message, stack: err.stack, code: (err as Record<string, unknown>).code, address: (err as Record<string, unknown>).address, port: (err as Record<string, unknown>).port }
      : { raw: String(err) };
    logger.error('LND invoice lookup failed, falling back to DB status', 'lightning-status', errDetail);
  }

  return NextResponse.json({ status: payment.status });
}
