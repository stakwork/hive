import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import QRCode from 'qrcode';
import { db } from '@/lib/db';
import { createLndInvoice } from '@/services/lightning';
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
  // TODO: replaced by dynamic USD→sats conversion in next ticket
  const amount = 500000;

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
