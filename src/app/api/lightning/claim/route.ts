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

  const payment = await db.lightningPayment.findUnique({
    where: { paymentHash },
  });

  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  // Idempotency: already claimed
  if (payment.userId) {
    return NextResponse.json({ success: true, redirect: '/onboarding/graphmindset?paymentType=lightning' });
  }

  if (payment.status !== 'PAID') {
    return NextResponse.json({ error: 'Payment not completed' }, { status: 402 });
  }

  await db.lightningPayment.update({
    where: { paymentHash },
    data: { userId },
  });

  return NextResponse.json({ success: true, redirect: '/onboarding/graphmindset?paymentType=lightning' });
}
