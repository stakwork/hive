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
    const { settled } = await lookupLndInvoice(paymentHash);
    if (settled) {
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
      return NextResponse.json({ status: 'PAID' });
    }
  } catch (err) {
    logger.error('LND invoice lookup failed, falling back to DB status', 'lightning-status', { err });
  }

  return NextResponse.json({ status: payment.status });
}
