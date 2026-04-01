import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStripeClient } from '@/services/stripe';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';

const checkoutBodySchema = z.object({
  workspaceName: z.string().min(1),
  workspaceSlug: z.string().min(1),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof checkoutBodySchema>;
  try {
    const raw = await req.json();
    body = checkoutBodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { workspaceName, workspaceSlug } = body;

  try {
    const stripe = getStripeClient();
    // Append session_id as a raw template variable (must not be URL-encoded)
    const baseSuccessUrl = process.env.STRIPE_SUCCESS_URL!;
    const separator = baseSuccessUrl.includes('?') ? '&' : '?';
    const successUrl = `${baseSuccessUrl}${separator}session_id={CHECKOUT_SESSION_ID}`;

    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      success_url: successUrl,
      cancel_url: process.env.STRIPE_CANCEL_URL!,
      metadata: { workspaceName, workspaceSlug },
    });

    await db.swarmPayment.create({
      data: {
        stripeSessionId: stripeSession.id,
        workspaceName,
        workspaceSlug,
        status: 'PENDING',
        workspaceId: null,
      },
    });

    return NextResponse.json({ sessionUrl: stripeSession.url, sessionId: stripeSession.id });
  } catch (err) {
    logger.error('Failed to create Stripe checkout session', 'stripe-checkout', { err });

    await db.swarmPayment.create({
      data: {
        stripeSessionId: `stripe_failed_${crypto.randomUUID()}`,
        workspaceName,
        workspaceSlug,
        status: 'PENDING',
        workspaceId: null,
      },
    });

    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
