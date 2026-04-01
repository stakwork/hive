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
    const workspaceId = stripeSession.metadata?.workspaceId;

    if (workspaceId) {
      // Path A: workspace already existed at checkout time — update payment status
      await db.$transaction([
        db.swarmPayment.update({
          where: { stripeSessionId },
          data: { status: 'PAID', stripePaymentIntentId },
        }),
        db.workspace.update({
          where: { id: workspaceId },
          data: { paymentStatus: 'PAID' },
        }),
      ]);
    } else {
      // Path B: unauthenticated checkout — no workspace yet.
      // The workspace will be created when the user claims via /api/stripe/claim after signing in.
      logger.info('Stripe session completed without workspaceId (pre-auth flow)', 'stripe-webhook', {
        stripeSessionId,
        workspaceName: stripeSession.metadata?.workspaceName,
      });
    }
  }

  if (event.type === 'checkout.session.expired') {
    const stripeSession = event.data.object as Stripe.Checkout.Session;
    // Only update if a SwarmPayment record exists (pre-auth flow has none)
    await db.swarmPayment.updateMany({
      where: { stripeSessionId: stripeSession.id },
      data: { status: 'EXPIRED' },
    });
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const failureCode =
      intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ?? null;
    const failureMessage = intent.last_payment_error?.message ?? null;

    const payment = await db.swarmPayment.findFirst({
      where: { stripePaymentIntentId: intent.id },
    });

    if (payment) {
      if (payment.workspaceId) {
        await db.$transaction([
          db.swarmPayment.update({
            where: { id: payment.id },
            data: { status: 'FAILED', failureCode, failureMessage },
          }),
          db.workspace.update({
            where: { id: payment.workspaceId },
            data: { paymentStatus: 'FAILED' },
          }),
        ]);
      } else {
        await db.swarmPayment.update({
          where: { id: payment.id },
          data: { status: 'FAILED', failureCode, failureMessage },
        });
      }
    } else {
      logger.info(
        'payment_intent.payment_failed: no matching SwarmPayment found (pre-auth or unknown)',
        'stripe-webhook',
        { paymentIntentId: intent.id },
      );
    }
  }

  return NextResponse.json({ received: true });
}
