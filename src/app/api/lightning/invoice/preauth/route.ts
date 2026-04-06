import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import QRCode from 'qrcode';
import { db } from '@/lib/db';
import { createLndInvoice } from '@/services/lightning';
import { fetchBtcPriceUsd } from '@/lib/btc-price';
import { logger } from '@/lib/logger';

const preauthBodySchema = z.object({
  workspaceName: z.string().min(1),
  workspaceSlug: z.string().min(1),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof preauthBodySchema>;
  try {
    const raw = await req.json();
    body = preauthBodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { workspaceName, workspaceSlug } = body;

  // 1. Read configured USD price
  const config = await db.platformConfig.findUnique({ where: { key: 'graphmindsetAmountUsd' } });
  if (!config) {
    return NextResponse.json({ error: 'Payment price not configured' }, { status: 503 });
  }
  const amountUsd = parseFloat(config.value);

  // 2. Fetch live BTC price — throws on failure
  let btcPriceUsd: number;
  try {
    btcPriceUsd = await fetchBtcPriceUsd();
  } catch {
    return NextResponse.json({ error: 'BTC price unavailable, please try again' }, { status: 503 });
  }

  // 3. Convert USD → sats
  const amount = Math.round((amountUsd / btcPriceUsd) * 100_000_000);

  const placeholderHash = `pending_${crypto.randomUUID()}`;

  await db.lightningPayment.create({
    data: {
      workspaceId: null,
      workspaceName,
      workspaceSlug,
      paymentHash: placeholderHash,
      invoice: '',
      amount,
      status: 'UNPAID',
    },
  });

  try {
    const { payment_hash, payment_request } = await createLndInvoice(amount);

    await db.lightningPayment.update({
      where: { paymentHash: placeholderHash },
      data: { paymentHash: payment_hash, invoice: payment_request },
    });

    const qrCodeDataUrl = await QRCode.toDataURL(payment_request, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      width: 300,
      margin: 2,
    });

    return NextResponse.json({ invoice: payment_request, paymentHash: payment_hash, amount, qrCodeDataUrl });
  } catch (err) {
    logger.error('Failed to create pre-auth LND invoice', 'lightning-preauth', { err });
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}
