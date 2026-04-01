import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/nextauth';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getStripeClient } from '@/services/stripe';
import { logger } from '@/lib/logger';

const claimBodySchema = z.object({
  sessionId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  let body: z.infer<typeof claimBodySchema> = {};
  try {
    const raw = await req.json();
    body = claimBodySchema.parse(raw);
  } catch {
    // Body is optional — sessionId can come from cookie
  }

  // Prefer body sessionId, fall back to cookie
  const sessionId = body.sessionId || req.cookies.get('stripe_session_id')?.value;
  if (!sessionId) {
    return NextResponse.json({ error: 'No payment session found' }, { status: 400 });
  }

<<<<<<< HEAD
  const userId = session.user.id;

  // Look up existing payment record (created at checkout time)
=======
  const { sessionId } = body;

  // Idempotency: if already PAID, return existing record without calling Stripe again
>>>>>>> master
  const existing = await db.swarmPayment.findUnique({
    where: { stripeSessionId: sessionId },
  });

  // Idempotency: if already claimed by this user, return it
  if (existing?.status === 'PAID' && existing?.userId === userId) {
    const res = NextResponse.json({ payment: existing });
    res.cookies.delete('stripe_session_id');
    return res;
  }

  // Retrieve and validate the Stripe session with Stripe API
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
<<<<<<< HEAD
    // Record was created at checkout time — update with userId and mark PAID
=======
    // Update existing PENDING record → PAID
>>>>>>> master
    payment = await db.swarmPayment.update({
      where: { stripeSessionId: sessionId },
      data: { status: 'PAID', stripePaymentIntentId, userId },
    });
  } else {
    // Create new PAID record (pre-auth: no SwarmPayment yet)
    const workspaceName = stripeSession.metadata?.workspaceName ?? null;
    const workspaceSlug = stripeSession.metadata?.workspaceSlug ?? null;
    payment = await db.swarmPayment.create({
      data: {
        stripeSessionId: sessionId,
        stripePaymentIntentId,
        workspaceName,
        workspaceSlug,
        status: 'PAID',
        userId,
      },
    });
  }

<<<<<<< HEAD
  const res = NextResponse.json({ payment });
  res.cookies.delete('stripe_session_id');
  return res;
=======
  // Record WorkspaceTransaction (workspaceId null at claim time — backfilled when workspace is created)
  try {
    await db.workspaceTransaction.create({
      data: {
        workspaceId: null,
        type: 'STRIPE',
        amountUsd: stripeSession.amount_total,
        currency: stripeSession.currency,
        swarmPaymentId: payment.id,
      },
    });
  } catch (err) {
    // Unique constraint: transaction already created by webhook (Path A) — safe to ignore
    logger.warn('WorkspaceTransaction already exists for SwarmPayment', 'stripe-claim', {
      swarmPaymentId: payment.id,
      err,
    });
  }

  return NextResponse.json({ payment });
>>>>>>> master
}
