import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/nextauth';
import { z } from 'zod';
import { db } from '@/lib/db';

const claimBodySchema = z.object({
  paymentHash: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  let body: z.infer<typeof claimBodySchema>;
  try {
    const raw = await req.json();
    body = claimBodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { paymentHash } = body;

  // Atomic compare-and-set: only updates when payment is PAID and not yet claimed
  const claimResult = await db.lightningPayment.updateMany({
    where: { paymentHash, status: 'PAID', userId: null },
    data: { userId },
  });

  if (claimResult.count === 0) {
    // Atomic update found nothing — determine why with a read-only fallback
    const payment = await db.lightningPayment.findUnique({ where: { paymentHash } });
    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }
    if (payment.status !== 'PAID') {
      return NextResponse.json({ error: 'Payment not completed' }, { status: 402 });
    }
    if (payment.userId === userId) {
      // Idempotent: same user re-claiming
      return NextResponse.json({ success: true, redirect: '/onboarding/graphmindset?paymentType=lightning' });
    }
    // Already claimed by a different user
    return NextResponse.json({ error: 'Payment already claimed' }, { status: 403 });
  }

  return NextResponse.json({ success: true, redirect: '/onboarding/graphmindset?paymentType=lightning' });
}
