import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { db } from '@/lib/db';
import { constructStripeEvent } from '@/services/stripe';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    event = constructStripeEvent(body, sig);
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', 'stripe-webhook', { err });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  if (event.type === 'checkout.session.completed') {
    const stripeSession = event.data.object as Stripe.Checkout.Session;
    const stripeSessionId = stripeSession.id;
    const stripePaymentIntentId =
      typeof stripeSession.payment_intent === 'string' ? stripeSession.payment_intent : null;

    await db.$transaction([
      db.swarmPayment.update({
        where: { stripeSessionId },
        data: { status: 'PAID', stripePaymentIntentId },
      }),
      db.workspace.update({
        where: { id: stripeSession.metadata?.workspaceId },
        data: { paymentStatus: 'PAID' },
      }),
    ]);
  }

  if (event.type === 'checkout.session.expired') {
    const stripeSession = event.data.object as Stripe.Checkout.Session;
    await db.swarmPayment.update({
      where: { stripeSessionId: stripeSession.id },
      data: { status: 'EXPIRED' },
    });
  }

  return NextResponse.json({ received: true });
}
