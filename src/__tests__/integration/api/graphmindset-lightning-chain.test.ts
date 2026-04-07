import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST as preauthPOST } from '@/app/api/lightning/invoice/preauth/route';
import { POST as claimPOST } from '@/app/api/lightning/claim/route';
import { GET as paymentGET } from '@/app/api/graphmindset/payment/route';
import { db } from '@/lib/db';
import { createTestUser, upsertTestPlatformConfig } from '@/__tests__/support/factories';
import {
  createAuthenticatedSession,
  getMockedSession,
  createPostRequest,
} from '@/__tests__/support/helpers';
import { NextRequest } from 'next/server';

// Mock LND invoice creation
const mockCreateLndInvoice = vi.fn();

vi.mock('@/services/lightning', () => ({
  createLndInvoice: (...args: unknown[]) => mockCreateLndInvoice(...args),
}));

// Mock QRCode (avoid canvas dependency in tests)
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr') },
}));

// Mock BTC price for deterministic sats calculation
vi.mock('@/lib/btc-price', () => ({
  fetchBtcPriceUsd: vi.fn().mockResolvedValue(100000),
}));

vi.mock('@/lib/rate-limit', () => ({
  getClientIp: vi.fn().mockReturnValue('1.2.3.4'),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

describe('GraphMindset lightning chain: preauth → webhook settle → claim → payment lookup', () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  const lndPaymentHash = `lnd_hash_${Date.now()}`;
  const lndInvoice = `lnbc1test_${Date.now()}`;

  beforeEach(async () => {
    vi.clearAllMocks();
    testUser = await createTestUser();

    // Seed PlatformConfig records required by the preauth route
    await upsertTestPlatformConfig('graphmindsetAmountUsd', '50');
    await upsertTestPlatformConfig('hiveAmountUsd', '50');

    // Re-apply mocks after clearAllMocks
    const { fetchBtcPriceUsd } = await import('@/lib/btc-price');
    vi.mocked(fetchBtcPriceUsd).mockResolvedValue(100000);

    mockCreateLndInvoice.mockResolvedValue({
      payment_hash: lndPaymentHash,
      payment_request: lndInvoice,
    });
  });

  test('full chain: preauth creates UNPAID → simulate settle → claim links user → payment endpoint returns it', async () => {
    // 1. Preauth (no auth) — creates LightningPayment + calls LND
    const preauthReq = createPostRequest('/api/lightning/invoice/preauth', {
      workspaceName: 'Lightning Graph',
      workspaceSlug: 'lightning-graph',
    });
    const preauthRes = await preauthPOST(preauthReq);
    expect(preauthRes.status).toBe(200);

    const preauthData = await preauthRes.json();
    expect(preauthData.paymentHash).toBe(lndPaymentHash);
    expect(preauthData.invoice).toBe(lndInvoice);
    expect(preauthData.qrCodeDataUrl).toBeTruthy();

    // Verify: UNPAID record in DB, no userId, no workspaceId
    const unpaidPayment = await db.lightningPayment.findUnique({
      where: { paymentHash: lndPaymentHash },
    });
    expect(unpaidPayment).not.toBeNull();
    expect(unpaidPayment!.status).toBe('UNPAID');
    expect(unpaidPayment!.userId).toBeNull();
    expect(unpaidPayment!.workspaceId).toBeNull();
    expect(unpaidPayment!.workspaceName).toBe('Lightning Graph');
    expect(unpaidPayment!.workspaceSlug).toBe('lightning-graph');
    expect(unpaidPayment!.invoice).toBe(lndInvoice);

    // 2. Simulate webhook settling the payment (as LND would)
    await db.lightningPayment.update({
      where: { paymentHash: lndPaymentHash },
      data: { status: 'PAID' },
    });

    // 3. Claim (requires auth) — links userId to payment
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const claimReq = new NextRequest('http://localhost/api/lightning/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentHash: lndPaymentHash }),
    });
    const claimRes = await claimPOST(claimReq);
    expect(claimRes.status).toBe(200);

    const claimData = await claimRes.json();
    expect(claimData.success).toBe(true);
    expect(claimData.redirect).toBe('/onboarding/graphmindset?paymentType=lightning');

    // Verify: userId now set on payment
    const claimedPayment = await db.lightningPayment.findUnique({
      where: { paymentHash: lndPaymentHash },
    });
    expect(claimedPayment!.userId).toBe(testUser.id);
    expect(claimedPayment!.status).toBe('PAID');
    expect(claimedPayment!.workspaceId).toBeNull();

    // 4. GET /api/graphmindset/payment?type=lightning — returns the claimed payment
    const paymentReq = new NextRequest(
      'http://localhost/api/graphmindset/payment?type=lightning',
    );
    const paymentRes = await paymentGET(paymentReq);
    expect(paymentRes.status).toBe(200);

    const paymentData = await paymentRes.json();
    expect(paymentData.payment.id).toBe(claimedPayment!.id);
    expect(paymentData.payment.workspaceName).toBe('Lightning Graph');
    expect(paymentData.payment.workspaceSlug).toBe('lightning-graph');
  });

  test('claim rejects UNPAID lightning payment', async () => {
    // Create via preauth
    const preauthReq = createPostRequest('/api/lightning/invoice/preauth', {
      workspaceName: 'Unpaid Graph',
      workspaceSlug: 'unpaid-graph',
    });
    await preauthPOST(preauthReq);

    // Try to claim without settling first
    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

    const claimReq = new NextRequest('http://localhost/api/lightning/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentHash: lndPaymentHash }),
    });
    const claimRes = await claimPOST(claimReq);

    expect(claimRes.status).toBe(402);
    const data = await claimRes.json();
    expect(data.error).toMatch(/not completed/i);

    // Payment should still have no userId
    const payment = await db.lightningPayment.findUnique({
      where: { paymentHash: lndPaymentHash },
    });
    expect(payment!.userId).toBeNull();
  });

  test('claimed payment disappears from graphmindset/payment after workspace linking', async () => {
    // Setup: preauth → settle → claim
    await preauthPOST(createPostRequest('/api/lightning/invoice/preauth', {
      workspaceName: 'Link Test',
      workspaceSlug: 'link-test',
    }));
    await db.lightningPayment.update({
      where: { paymentHash: lndPaymentHash },
      data: { status: 'PAID' },
    });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
    await claimPOST(new NextRequest('http://localhost/api/lightning/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentHash: lndPaymentHash }),
    }));

    // Confirm it's visible
    const beforeRes = await paymentGET(
      new NextRequest('http://localhost/api/graphmindset/payment?type=lightning'),
    );
    expect(beforeRes.status).toBe(200);

    // Now link it to a workspace (simulating what POST /api/workspaces does)
    const workspace = await db.workspace.create({
      data: { name: 'link-test', slug: `link-test-${Date.now()}`, ownerId: testUser.id },
    });
    await db.lightningPayment.update({
      where: { paymentHash: lndPaymentHash },
      data: { workspaceId: workspace.id },
    });

    // Should no longer appear (workspaceId is no longer null)
    const afterRes = await paymentGET(
      new NextRequest('http://localhost/api/graphmindset/payment?type=lightning'),
    );
    expect(afterRes.status).toBe(404);
  });

  test('preauth creates placeholder then updates with real LND hash', async () => {
    const preauthReq = createPostRequest('/api/lightning/invoice/preauth', {
      workspaceName: 'Placeholder Test',
      workspaceSlug: 'placeholder-test',
    });
    await preauthPOST(preauthReq);

    // Should NOT have a pending_ prefixed hash in DB (it gets replaced)
    const pendingPayments = await db.lightningPayment.findMany({
      where: { paymentHash: { startsWith: 'pending_' } },
    });
    expect(pendingPayments).toHaveLength(0);

    // Should have the real LND hash
    const realPayment = await db.lightningPayment.findUnique({
      where: { paymentHash: lndPaymentHash },
    });
    expect(realPayment).not.toBeNull();
    expect(realPayment!.invoice).toBe(lndInvoice);
  });
});
