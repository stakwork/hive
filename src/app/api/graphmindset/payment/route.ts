import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/nextauth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * GET /api/graphmindset/payment
 *
 * Returns the authenticated user's most recent PAID FiatPayment
 * that hasn't been linked to a workspace yet.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payment = await db.fiatPayment.findFirst({
    where: {
      userId: session.user.id,
      status: 'PAID',
      workspaceId: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (payment) {
    return NextResponse.json({
      payment: {
        id: payment.id,
        workspaceName: payment.workspaceName,
        workspaceSlug: payment.workspaceSlug,
        status: payment.status,
      },
    });
  }

  // Fallback: check LightningPayment for the same user
  const lightningPayment = await db.lightningPayment.findFirst({
    where: {
      userId: session.user.id,
      status: 'PAID',
      workspaceId: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!lightningPayment) {
    return NextResponse.json({ error: 'No pending payment found' }, { status: 404 });
  }

  return NextResponse.json({
    payment: {
      id: lightningPayment.id,
      workspaceName: lightningPayment.workspaceName,
      workspaceSlug: lightningPayment.workspaceSlug,
      status: lightningPayment.status,
    },
  });
}
