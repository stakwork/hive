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
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type'); // 'fiat' | 'lightning' | null

  if (type !== 'lightning') {
    // Query FiatPayment when type=fiat or type is omitted
    const payment = await db.fiatPayment.findFirst({
      where: { userId: session.user.id, status: 'PAID', workspaceId: null },
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

    // If type=fiat was explicit, stop here
    if (type === 'fiat') {
      return NextResponse.json({ error: 'No pending payment found' }, { status: 404 });
    }
  }

  // type=lightning, or fallback when no fiat payment found
  const lightningPayment = await db.lightningPayment.findFirst({
    where: { userId: session.user.id, status: 'PAID', workspaceId: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!lightningPayment) {
    // No unclaimed payment — check if workspace was already provisioned
    const claimedFiat = await db.fiatPayment.findFirst({
      where: { userId: session.user.id, status: 'PAID', workspaceId: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: { workspace: { select: { slug: true, deleted: true } } },
    });

    if (claimedFiat?.workspace && !claimedFiat.workspace.deleted) {
      return NextResponse.json({
        alreadyProvisioned: true,
        workspaceSlug: claimedFiat.workspace.slug,
      });
    }

    const claimedLightning = await db.lightningPayment.findFirst({
      where: { userId: session.user.id, status: 'PAID', workspaceId: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: { workspace: { select: { slug: true, deleted: true } } },
    });

    if (claimedLightning?.workspace && !claimedLightning.workspace.deleted) {
      return NextResponse.json({
        alreadyProvisioned: true,
        workspaceSlug: claimedLightning.workspace.slug,
      });
    }

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
