import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/nextauth';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getStripeClient } from '@/services/stripe';
import { logger } from '@/lib/logger';
import { createWorkspace, ensureUniqueSlug } from '@/services/workspace';
import { SwarmService } from '@/services/swarm';
import { getServiceConfig } from '@/config/services';
import { generateSecurePassword } from '@/lib/utils/password';
import { saveOrUpdateSwarm } from '@/services/swarm/db';
import { SwarmStatus } from '@prisma/client';
import { SWARM_DEFAULT_INSTANCE_TYPE } from '@/lib/constants';

const claimBodySchema = z.object({
  sessionId: z.string().min(1),
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

  const { sessionId } = body;

  // Idempotency: if this session was already claimed, return the existing workspace
  const existing = await db.swarmPayment.findUnique({
    where: { stripeSessionId: sessionId },
    include: { workspace: true },
  });
  if (existing) {
    return NextResponse.json({ workspace: existing.workspace });
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

  const workspaceName = stripeSession.metadata?.workspaceName;
  const workspaceSlug = stripeSession.metadata?.workspaceSlug;
  const stripePaymentIntentId =
    typeof stripeSession.payment_intent === 'string' ? stripeSession.payment_intent : null;
  if (!workspaceName || !workspaceSlug) {
    return NextResponse.json({ error: 'Missing workspace metadata in payment session' }, { status: 400 });
  }

  // Ensure slug uniqueness at claim time
  const finalSlug = await ensureUniqueSlug(workspaceSlug);

  let workspace;
  try {
    workspace = await createWorkspace({
      name: workspaceName,
      slug: finalSlug,
      ownerId: userId,
      workspaceKind: 'graph_mindset',
    });
  } catch (err) {
    logger.error('Failed to create workspace during claim', 'stripe-claim', { err });
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 });
  }

  await db.$transaction([
    db.swarmPayment.create({
      data: {
        workspaceId: workspace.id,
        stripeSessionId: sessionId,
        stripePaymentIntentId,
        status: 'PAID',
      },
    }),
    db.workspace.update({
      where: { id: workspace.id },
      data: { paymentStatus: 'PAID' },
    }),
  ]);

  // Kick off swarm provisioning (non-blocking — failures are logged but don't fail the response)
  (async () => {
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
        workspaceId: workspace.id,
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
      logger.error('Failed to provision swarm after claim', 'stripe-claim', { err });
    }
  })();

  return NextResponse.json({ workspace });
}
