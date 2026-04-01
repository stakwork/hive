import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/nextauth';
import { z } from 'zod';
import { db } from '@/lib/db';
import { stakworkService } from '@/lib/service-factory';
import { logger } from '@/lib/logger';
import { EncryptionService } from '@/lib/encryption';
import { optionalEnvVars } from '@/config/env';

export const runtime = 'nodejs';

const createBodySchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9-]+$/, 'Name must contain only letters, numbers, and hyphens'),
});

/**
 * POST /api/graphmindset/create
 *
 * Creates a GraphMindset graph:
 * 1. Create Stakwork customer (gets customerId + token)
 * 2. Create swarm via super admin API (with vanity address + env vars)
 * 3. Return graph details
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pubkey = (session.user as { lightningPubkey?: string }).lightningPubkey;

  let body: z.infer<typeof createBodySchema>;
  try {
    const raw = await req.json();
    body = createBodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { name } = body;
  const slug = name.toLowerCase().replace(/\s+/g, '-');

  // Fetch the user's PAID, unlinked SwarmPayment to retrieve the stored password
  const paymentRecord = await db.swarmPayment.findFirst({
    where: { userId: session.user.id, status: 'PAID', workspaceId: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!paymentRecord || !paymentRecord.password) {
    return NextResponse.json({ error: 'No valid payment found' }, { status: 400 });
  }

  const password = EncryptionService.getInstance().decryptField('swarmPaymentPassword', paymentRecord.password);

  try {
    // Step 1: Create Stakwork customer
    const customerResponse = await stakworkService().createCustomer(name);
    const customerData =
      customerResponse && typeof customerResponse === 'object' && 'data' in customerResponse
        ? (customerResponse as { data?: { id?: number | string; token?: string } }).data
        : undefined;

    const customerId = customerData?.id != null ? String(customerData.id) : undefined;
    const token = customerData?.token;

    // Step 2: Create swarm via super admin
    const swarmAdminUrl = optionalEnvVars.SWARM_SUPER_ADMIN_URL;
    if (!swarmAdminUrl) {
      return NextResponse.json({ error: 'Swarm admin not configured' }, { status: 500 });
    }

    const swarmBody = {
      instance_type: 'm6i.xlarge',
      name: `${slug}-Swarm`,
      vanity_address: `${slug}.sphinx.chat`,
      password,
      workspace_type: 'graph_mindset',
      ...(token || pubkey || customerId
        ? {
            env: {
              ...(token ? { STAKWORK_ADD_NODE_TOKEN: token, STAKWORK_RADAR_REQUEST_TOKEN: token } : {}),
              ...(pubkey ? { OWNER_PUBKEY: pubkey } : {}),
              ...(customerId ? { STAKWORK_CUSTOMER_ID: customerId } : {}),
            },
          }
        : {}),
    };

    const swarmRes = await fetch(`${swarmAdminUrl}/api/super/new_swarm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-super-token': process.env.SWARM_SUPERADMIN_API_KEY as string,
      },
      body: JSON.stringify(swarmBody),
    });

    if (!swarmRes.ok) {
      const text = await swarmRes.text();
      logger.error('Failed to create graph swarm', 'graphmindset-create', { status: swarmRes.status, text });
      return NextResponse.json({ error: 'Failed to create graph' }, { status: 500 });
    }

    const swarmData = await swarmRes.json();
    if (!swarmData.success) {
      return NextResponse.json({ error: swarmData.message || 'Failed to create graph' }, { status: 500 });
    }

    // Extract swarm ID
    const swarmId = swarmData.id != null
      ? String(swarmData.id)
      : swarmData.data?.id != null
        ? String(swarmData.data.id)
        : undefined;

    return NextResponse.json({
      success: true,
      graph: {
        name: slug,
        swarmId,
        url: `https://${slug}.sphinx.chat`,
        customerId,
      },
    });
  } catch (err) {
    logger.error('Error creating GraphMindset graph', 'graphmindset-create', { err });
    return NextResponse.json({ error: 'Failed to create graph' }, { status: 500 });
  }
}
