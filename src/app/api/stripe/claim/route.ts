import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/nextauth';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getStripeClient } from '@/services/stripe';
import { logger } from '@/lib/logger';

const claimBodySchema = z.object({
  sessionId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof claimBodySchema>;
  try {
    const raw = await req.json();
    body = claimBodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { sessionId } = body;
  const userId = session.user.id;

  // Idempotency: if already claimed as PAID, return the existing payment
  const existing = await db.swarmPayment.findUnique({
    where: { stripeSessionId: sessionId },
  });
  if (existing?.status === 'PAID') {
    return NextResponse.json({ payment: existing });
  }

  // Retrieve and validate the Stripe session
  const stripe = getStripeClient();
  let stripeSession;
  try {
    stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    logger.error('Failed to retrieve Stripe session', 'stripe-claim', { err });
    return NextResponse.json({ error: 'Invalid payment session' }, { status: 400 });
  }

  if (stripeSession.payment_status !== 'paid') {
    return NextResponse.json({ error: 'Payment not completed' }, { status: 402 });
  }

  const stripePaymentIntentId =
    typeof stripeSession.payment_intent === 'string' ? stripeSession.payment_intent : null;

  let payment;
  if (existing) {
    // Record was created at checkout time (PENDING) — update it to PAID
    payment = await db.swarmPayment.update({
      where: { stripeSessionId: sessionId },
      data: { status: 'PAID', stripePaymentIntentId },
    });
  } else {
    // No prior record (e.g. checkout bypassed) — create one
    payment = await db.swarmPayment.create({
      data: {
        stripeSessionId: sessionId,
        stripePaymentIntentId,
        status: 'PAID',
        userId,
      },
    });
  }

  return NextResponse.json({ payment });
}
