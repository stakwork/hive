import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { db } from '@/lib/db';
import { constructStripeEvent } from '@/services/stripe';
import { logger } from '@/lib/logger';
import { SwarmService } from '@/services/swarm';
import { getServiceConfig } from '@/config/services';
import { generateSecurePassword } from '@/lib/utils/password';
import { saveOrUpdateSwarm } from '@/services/swarm/db';
import { SwarmStatus } from '@prisma/client';
import { SWARM_DEFAULT_INSTANCE_TYPE } from '@/lib/constants';

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
      // Path A: workspace already existed at checkout time — update payment status and provision swarm
      const swarmPayment = await db.swarmPayment.findUnique({ where: { stripeSessionId } });
      await db.$transaction([
        db.swarmPayment.update({
          where: { stripeSessionId },
          data: { status: 'PAID', stripePaymentIntentId },
        }),
        db.workspace.update({
          where: { id: workspaceId },
          data: { paymentStatus: 'PAID' },
        }),
        db.workspaceTransaction.create({
          data: {
            workspaceId,
            type: 'STRIPE',
            amountUsd: stripeSession.amount_total,
            currency: stripeSession.currency,
            swarmPaymentId: swarmPayment?.id ?? null,
          },
        }),
      ]);

      const existingSwarm = await db.swarm.findFirst({ where: { workspaceId } });
      if (!existingSwarm) {
        try {
          const swarmService = new SwarmService(getServiceConfig('swarm'));
          const swarmPassword = generateSecurePassword(20);
          const apiResponse = await swarmService.createSwarm({
            instance_type: SWARM_DEFAULT_INSTANCE_TYPE,
            password: swarmPassword,
          });
          const { swarm_id, address, x_api_key, ec2_id } = apiResponse.data;
          await saveOrUpdateSwarm({
            workspaceId,
            name: swarm_id,
            status: SwarmStatus.ACTIVE,
            swarmUrl: `https://${address}/api`,
            ec2Id: ec2_id,
            swarmApiKey: x_api_key,
            swarmSecretAlias: `{{${swarm_id}_API_KEY}}`,
            swarmId: swarm_id,
            swarmPassword,
          });
        } catch (err) {
          logger.error('Failed to create graph_mindset swarm after payment', 'stripe-webhook', { err });
          // Do NOT rethrow — webhook must always return 2xx
        }
      }
    } else {
      // Path B: unauthenticated checkout — no workspace yet; record payment intent only.
      // The workspace will be created when the user claims via /api/stripe/claim after signing in.
      // SwarmPayment row is created at claim time, so nothing to update here.
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
