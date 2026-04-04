import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST as checkoutPOST } from '@/app/api/stripe/checkout/route';
import { POST as claimPOST } from '@/app/api/stripe/claim/route';
import { GET as paymentGET } from '@/app/api/graphmindset/payment/route';
import { db } from '@/lib/db';
import { createTestUser } from '@/__tests__/support/factories';
import {
  createAuthenticatedSession,
  getMockedSession,
  createPostRequest,
} from '@/__tests__/support/helpers';
import { NextRequest } from 'next/server';

// Mock Stripe — checkout creates a session, claim retrieves it
const mockCreateSession = vi.fn();
const mockRetrieveSession = vi.fn();

vi.mock('@/services/stripe', () => ({
  getStripeClient: vi.fn(() => ({
    checkout: {
      sessions: {
        create: (...args: unknown[]) => mockCreateSession(...args),
        retrieve: (...args: unknown[]) => mockRetrieveSession(...args),
      },
    },
  })),
}));

describe('GraphMindset checkout → claim round-trip', () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  const sessionId = `cs_test_roundtrip_${Date.now()}`;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('STRIPE_SUCCESS_URL', 'https://example.com/success');
    vi.stubEnv('STRIPE_CANCEL_URL', 'https://example.com/cancel');
    vi.stubEnv('STRIPE_PRICE_ID', 'price_test_123');

    testUser = await createTestUser();

    // Stripe mock: checkout creates session, claim retrieves it
    mockCreateSession.mockResolvedValue({
      id: sessionId,
      url: `https://checkout.stripe.com/pay/${sessionId}`,
    });

    mockRetrieveSession.mockResolvedValue({
      id: sessionId,
      payment_status: 'paid',
      payment_intent: 'pi_test_roundtrip',
      metadata: {
        workspaceName: 'My Graph',
        workspaceSlug: 'my-graph',
        workspaceType: '',
        repositoryUrl: '',
      },
    });
  });

  test('checkout creates PENDING payment, claim marks PAID with userId, payment endpoint returns it', async () => {
    // 1. Checkout (no auth required) — creates PENDING FiatPayment
    const checkoutReq = createPostRequest('/api/stripe/checkout', {
      workspaceName: 'My Graph',
      workspaceSlug: 'my-graph',
    });
    const checkoutRes = await checkoutPOST(checkoutReq);
    expect(checkoutRes.status).toBe(200);

    const checkoutData = await checkoutRes.json();
    expect(checkoutData.sessionId).toBe(sessionId);

    // Verify: PENDING record in DB, no userId
    const pendingPayment = await db.fiatPayment.findUnique({
      where: { stripeSessionId: sessionId },
    });
    expect(pendingPayment).not.toBeNull();
    expect(pendingPayment!.status).toBe('PENDING');
    expect(pendingPayment!.userId).toBeNull();
    expect(pendingPayment!.workspaceId).toBeNull();
    expect(pendingPayment!.workspaceName).toBe('My Graph');
    expect(pendingPayment!.password).toBeTruthy();

    // 2. Claim (requires auth) — updates to PAID, links userId
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const claimReq = new NextRequest('http://localhost/api/stripe/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const claimRes = await claimPOST(claimReq);
    expect(claimRes.status).toBe(200);

    const claimData = await claimRes.json();
    expect(claimData.payment.status).toBe('PAID');
    expect(claimData.payment.userId).toBe(testUser.id);
    expect(claimData.redirect).toBe('/onboarding/graphmindset?paymentType=fiat');

    // Verify: DB reflects PAID + userId, no workspace yet
    const paidPayment = await db.fiatPayment.findUnique({
      where: { stripeSessionId: sessionId },
    });
    expect(paidPayment!.status).toBe('PAID');
    expect(paidPayment!.userId).toBe(testUser.id);
    expect(paidPayment!.workspaceId).toBeNull();
    expect(paidPayment!.stripePaymentIntentId).toBe('pi_test_roundtrip');

    // 3. GET /api/graphmindset/payment — should find this unclaimed payment
    const paymentReq = new NextRequest('http://localhost/api/graphmindset/payment');
    const paymentRes = await paymentGET(paymentReq);
    expect(paymentRes.status).toBe(200);

    const paymentData = await paymentRes.json();
    expect(paymentData.payment.id).toBe(paidPayment!.id);
    expect(paymentData.payment.workspaceName).toBe('My Graph');
    expect(paymentData.payment.workspaceSlug).toBe('my-graph');
  });

  test('checkout with workspaceType=hive round-trips metadata through claim', async () => {
    mockCreateSession.mockResolvedValue({
      id: `cs_hive_${Date.now()}`,
      url: 'https://checkout.stripe.com/pay/cs_hive',
    });

    const hiveSessionId = mockCreateSession.mock.results.length
      ? `cs_hive_${Date.now()}`
      : `cs_hive_fallback`;

    // Re-mock to capture the actual session ID
    const actualSessionId = `cs_hive_roundtrip_${Date.now()}`;
    mockCreateSession.mockResolvedValue({
      id: actualSessionId,
      url: `https://checkout.stripe.com/pay/${actualSessionId}`,
    });

    const checkoutReq = createPostRequest('/api/stripe/checkout', {
      workspaceName: 'My Hive',
      workspaceSlug: 'my-hive',
      workspaceType: 'hive',
      repositoryUrl: 'https://github.com/org/repo',
    });
    const checkoutRes = await checkoutPOST(checkoutReq);
    expect(checkoutRes.status).toBe(200);

    // Verify metadata was passed to Stripe
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          workspaceType: 'hive',
          repositoryUrl: 'https://github.com/org/repo',
        }),
      }),
    );

    // Claim with Stripe returning the metadata back
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
    mockRetrieveSession.mockResolvedValue({
      id: actualSessionId,
      payment_status: 'paid',
      payment_intent: 'pi_hive_123',
      metadata: {
        workspaceName: 'My Hive',
        workspaceSlug: 'my-hive',
        workspaceType: 'hive',
        repositoryUrl: 'https://github.com/org/repo',
      },
    });

    const claimReq = new NextRequest('http://localhost/api/stripe/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: actualSessionId }),
    });
    const claimRes = await claimPOST(claimReq);
    expect(claimRes.status).toBe(200);

    const claimData = await claimRes.json();
    expect(claimData.workspaceType).toBe('hive');
    expect(claimData.repositoryUrl).toBe('https://github.com/org/repo');
  });

  test('encrypted password survives the checkout → claim cycle', async () => {
    // Checkout creates payment with encrypted password
    const checkoutReq = createPostRequest('/api/stripe/checkout', {
      workspaceName: 'Password Test',
      workspaceSlug: 'password-test',
    });
    await checkoutPOST(checkoutReq);

    const payment = await db.fiatPayment.findUnique({
      where: { stripeSessionId: sessionId },
    });

    // Password should be encrypted JSON (not plaintext)
    expect(payment!.password).toBeTruthy();
    const parsed = JSON.parse(payment!.password!);
    expect(parsed).toHaveProperty('data');
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('tag');

    // Claim doesn't touch the password — verify it's unchanged
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
    const claimReq = new NextRequest('http://localhost/api/stripe/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    await claimPOST(claimReq);

    const afterClaim = await db.fiatPayment.findUnique({
      where: { stripeSessionId: sessionId },
    });
    expect(afterClaim!.password).toBe(payment!.password);
  });
});
