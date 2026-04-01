import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/nextauth';
import { z } from 'zod';
import { db } from '@/lib/db';
import { createLndInvoice } from '@/services/lightning';
import { logger } from '@/lib/logger';

const invoiceBodySchema = z.object({
  workspaceId: z.string(),
  amount: z.number().positive().int(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof invoiceBodySchema>;
  try {
    const raw = await req.json();
    body = invoiceBodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { workspaceId, amount } = body;

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  if (workspace.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { payment_hash, payment_request } = await createLndInvoice(amount);

    await db.lightningPayment.create({
      data: {
        workspaceId,
        paymentHash: payment_hash,
        invoice: payment_request,
        amount,
        status: 'UNPAID',
        userId: session.user.id,
      },
    });

    return NextResponse.json({ invoice: payment_request, paymentHash: payment_hash, amount });
  } catch (err) {
    logger.error('Failed to create LND invoice', 'lightning-invoice', { err });
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = req.nextUrl.searchParams.get('workspaceId');
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
  }

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  if (workspace.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const payment = await db.lightningPayment.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ payment });
}
