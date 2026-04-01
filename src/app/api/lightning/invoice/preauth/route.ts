import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import QRCode from 'qrcode';
import { db } from '@/lib/db';
import { createLndInvoice } from '@/services/lightning';
import { optionalEnvVars } from '@/config/env';
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
  const amount = optionalEnvVars.LIGHTNING_AMOUNT_SATS;

  try {
    const { payment_hash, payment_request } = await createLndInvoice(amount);

    const qrCodeDataUrl = await QRCode.toDataURL(payment_request, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      width: 300,
      margin: 2,
    });

    await db.lightningPayment.create({
      data: {
        workspaceId: null,
        workspaceName,
        workspaceSlug,
        paymentHash: payment_hash,
        invoice: payment_request,
        amount,
        status: 'UNPAID',
      },
    });

    return NextResponse.json({ invoice: payment_request, paymentHash: payment_hash, amount, qrCodeDataUrl });
  } catch (err) {
    logger.error('Failed to create pre-auth LND invoice', 'lightning-preauth', { err });
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}
