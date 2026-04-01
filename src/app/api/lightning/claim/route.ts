import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/nextauth';
import { z } from 'zod';
import { db } from '@/lib/db';
import { createWorkspace, ensureUniqueSlug } from '@/services/workspace';
import { SwarmService } from '@/services/swarm';
import { getServiceConfig } from '@/config/services';
import { generateSecurePassword } from '@/lib/utils/password';
import { saveOrUpdateSwarm } from '@/services/swarm/db';
import { SwarmStatus } from '@prisma/client';
import { SWARM_DEFAULT_INSTANCE_TYPE } from '@/lib/constants';
import { logger } from '@/lib/logger';

const claimBodySchema = z.object({
  paymentHash: z.string().min(1),
  password: z.string().min(1),
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

  // Idempotency: already claimed → return existing workspace
  if (payment.workspaceId) {
    const workspace = await db.workspace.findUnique({ where: { id: payment.workspaceId } });
    return NextResponse.json({ workspace });
  }

  if (payment.status !== 'PAID') {
    return NextResponse.json({ error: 'Payment not completed' }, { status: 402 });
  }

  if (!payment.workspaceName || !payment.workspaceSlug) {
    return NextResponse.json({ error: 'Missing workspace metadata on payment' }, { status: 400 });
  }

  const finalSlug = await ensureUniqueSlug(payment.workspaceSlug);

  let workspace;
  try {
    workspace = await createWorkspace({
      name: payment.workspaceName,
      slug: finalSlug,
      ownerId: userId,
      workspaceKind: 'graph_mindset',
    });
  } catch (err) {
    logger.error('Failed to create workspace during lightning claim', 'lightning-claim', { err });
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 });
  }

  await db.$transaction([
    db.lightningPayment.update({
      where: { paymentHash },
      data: { workspaceId: workspace.id },
    }),
    db.workspace.update({
      where: { id: workspace.id },
      data: { paymentStatus: 'PAID' },
    }),
    db.workspaceTransaction.updateMany({
      where: { lightningPaymentId: payment.id },
      data: { workspaceId: workspace.id },
    }),
  ]);

  // Provision swarm non-blocking
  (async () => {
    try {
      const swarmService = new SwarmService(getServiceConfig('swarm'));
      const swarmPassword = generateSecurePassword(20);
      const apiResponse = await swarmService.createSwarm({
        instance_type: SWARM_DEFAULT_INSTANCE_TYPE,
        password: swarmPassword,
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
      });
    } catch (err) {
      logger.error('Failed to provision swarm after lightning claim', 'lightning-claim', { err });
    }
  })();

  return NextResponse.json({ workspace });
}
