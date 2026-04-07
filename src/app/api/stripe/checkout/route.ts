import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStripeClient } from '@/services/stripe';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { generateSecurePassword } from '@/lib/utils/password';
import { EncryptionService } from '@/lib/encryption';
import { getClientIp, checkRateLimit } from '@/lib/rate-limit';

const checkoutBodySchema = z.object({
  workspaceName: z.string().min(1),
  workspaceSlug: z.string().min(1),
  workspaceType: z.string().optional(),
  repositoryUrl: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(`rl:stripe-checkout:${ip}`, 10, 60);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  let body: z.infer<typeof checkoutBodySchema>;
  try {
    const raw = await req.json();
    body = checkoutBodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { workspaceName, workspaceSlug, workspaceType, repositoryUrl } = body;

  const password = generateSecurePassword(20);
  const encryptedPassword = JSON.stringify(
    EncryptionService.getInstance().encryptField('fiatPaymentPassword', password)
  );

  const priceConfig = await db.platformConfig.findUnique({ where: { key: 'hiveAmountUsd' } });
  if (!priceConfig) {
    return NextResponse.json({ error: 'Payment price not configured' }, { status: 503 });
  }
  const hiveAmountUsd = parseFloat(priceConfig.value);

  try {
    const stripe = getStripeClient();
    // Append session_id as a raw template variable (must not be URL-encoded)
    const baseSuccessUrl = process.env.STRIPE_SUCCESS_URL!;
    const separator = baseSuccessUrl.includes('?') ? '&' : '?';
    const successUrl = `${baseSuccessUrl}${separator}session_id={CHECKOUT_SESSION_ID}`;

    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(hiveAmountUsd * 100), // cents
          product_data: { name: 'Hive Environment' },
        },
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: process.env.STRIPE_CANCEL_URL!,
      metadata: { workspaceName, workspaceSlug, workspaceType: workspaceType ?? '', repositoryUrl: repositoryUrl ?? '' },
    });

    await db.fiatPayment.create({
      data: {
        stripeSessionId: stripeSession.id,
        workspaceName,
        workspaceSlug,
        status: 'PENDING',
        workspaceId: null,
        password: encryptedPassword,
      },
    });

    const res = NextResponse.json({ sessionUrl: stripeSession.url, sessionId: stripeSession.id });
    res.cookies.set('stripe_session_id', stripeSession.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });
    return res;
  } catch (err) {
    logger.error('Failed to create Stripe checkout session', 'stripe-checkout', { err });

    await db.fiatPayment.create({
      data: {
        stripeSessionId: `stripe_failed_${crypto.randomUUID()}`,
        workspaceName,
        workspaceSlug,
        status: 'PENDING',
        workspaceId: null,
        password: encryptedPassword,
      },
    });

    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
