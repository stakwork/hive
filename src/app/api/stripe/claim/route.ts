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

  // Retrieve and validate the Stripe session first (needed for metadata on all paths)
  const stripe = getStripeClient();
  let stripeSession;
  try {
    stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    logger.error('Failed to retrieve Stripe session', 'stripe-claim', { err });
    return NextResponse.json({ error: 'Invalid payment session' }, { status: 400 });
  }

  const workspaceType = stripeSession.metadata?.workspaceType || null;
  const repositoryUrl = stripeSession.metadata?.repositoryUrl || null;

  // Check whether a FiatPayment record already exists for this session
  const existing = await db.fiatPayment.findUnique({
    where: { stripeSessionId: sessionId },
  });

  // Idempotency: already claimed by this user
  if (existing?.status === 'PAID' && existing?.userId === userId) {
    const res = NextResponse.json({ payment: existing, workspaceType, repositoryUrl, redirect: '/onboarding/graphmindset?paymentType=fiat' });
    res.cookies.delete('stripe_session_id');
    return res;
  }

  // Guard: reject if already claimed by a different user — clear cookie to stop retry loops
  if (existing?.userId && existing.userId !== userId) {
    const res = NextResponse.json({ error: 'Payment already claimed' }, { status: 403 });
    res.cookies.delete('stripe_session_id');
    return res;
  }

  if (stripeSession.payment_status !== 'paid') {
    return NextResponse.json({ error: 'Payment not completed' }, { status: 402 });
  }

  const stripePaymentIntentId =
    typeof stripeSession.payment_intent === 'string' ? stripeSession.payment_intent : null;

  let payment;
  if (existing) {
    // Record was created at checkout time — use atomic compare-and-set to prevent
    // concurrent claims from two different users both seeing userId: null
    const claimResult = await db.fiatPayment.updateMany({
      where: { stripeSessionId: sessionId, userId: null },
      data: { status: 'PAID', stripePaymentIntentId, userId },
    });

    if (claimResult.count === 0) {
      // Another concurrent request claimed it — read-only fallback to discriminate
      const updated = await db.fiatPayment.findUnique({ where: { stripeSessionId: sessionId } });
      if (updated?.userId === userId) {
        // Idempotent: same user won the race
        const res = NextResponse.json({ payment: updated, workspaceType, repositoryUrl, redirect: '/onboarding/graphmindset?paymentType=fiat' });
        res.cookies.delete('stripe_session_id');
        return res;
      }
      const res = NextResponse.json({ error: 'Payment already claimed' }, { status: 403 });
      res.cookies.delete('stripe_session_id');
      return res;
    }

    payment = await db.fiatPayment.findUnique({ where: { stripeSessionId: sessionId } });
  } else {
    // Create new PAID record (pre-auth: no FiatPayment yet)
    const workspaceName = stripeSession.metadata?.workspaceName ?? null;
    const workspaceSlug = stripeSession.metadata?.workspaceSlug ?? null;
    payment = await db.fiatPayment.create({
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

  const res = NextResponse.json({ payment, workspaceType, repositoryUrl, redirect: '/onboarding/graphmindset?paymentType=fiat' });
  res.cookies.delete('stripe_session_id');
  return res;
}
