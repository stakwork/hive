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

    const workspaceId = stripeSession.metadata?.workspaceId;
    if (workspaceId) {
      const existingSwarm = await db.swarm.findFirst({ where: { workspaceId } });
      if (!existingSwarm) {
        try {
          const swarmService = new SwarmService(getServiceConfig('swarm'));
          const swarmPassword = generateSecurePassword(20);
          const apiResponse = await swarmService.createSwarm({
            instance_type: SWARM_DEFAULT_INSTANCE_TYPE,
            password: swarmPassword,
            workspace_type: 'graph_mindset',
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
            workspaceType: 'graph_mindset',
          });
        } catch (err) {
          logger.error('Failed to create graph_mindset swarm after payment', 'stripe-webhook', {
            err,
          });
          // Do NOT rethrow — webhook must always return 2xx
        }
      }
    }
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
