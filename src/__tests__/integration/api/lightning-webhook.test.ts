import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/lightning/webhook/route';
import { db } from '@/lib/db';
import { createTestWorkspaceScenario } from '@/__tests__/support/factories/workspace.factory';
import { createTestLightningPayment } from '@/__tests__/support/factories/lightning-payment.factory';
import { NextRequest } from 'next/server';

vi.mock('@/services/lightning', () => ({
  lookupLndInvoice: vi.fn(),
}));

vi.mock('@/lib/btc-price', () => ({
  fetchBtcPriceUsd: vi.fn(),
}));

import { lookupLndInvoice } from '@/services/lightning';
import { fetchBtcPriceUsd } from '@/lib/btc-price';
const mockLookupLndInvoice = vi.mocked(lookupLndInvoice);
const mockFetchBtcPriceUsd = vi.mocked(fetchBtcPriceUsd);

function buildWebhookRequest(body: Record<string, unknown>, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/lightning/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'test-secret', ...headers },
    body: JSON.stringify(body),
  });
}

describe('Lightning Webhook Handler Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchBtcPriceUsd.mockResolvedValue(50000);
    mockLookupLndInvoice.mockResolvedValue({ settled: true });
    process.env.LIGHTNING_WEBHOOK_SECRET = 'test-secret';
  });

  describe('POST /api/lightning/webhook', () => {
    test('returns 401 when x-webhook-secret header is missing', async () => {
      const req = new NextRequest('http://localhost/api/lightning/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_hash: 'any_hash' }),
      });
      const response = await POST(req);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: 'Unauthorized' });
    });

    test('returns 401 when x-webhook-secret header is wrong', async () => {
      const req = buildWebhookRequest({ payment_hash: 'any_hash' }, { 'x-webhook-secret': 'wrong-secret' });
      const response = await POST(req);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: 'Unauthorized' });
    });

    test('does not mark payment PAID when LND reports invoice not settled', async () => {
      mockLookupLndInvoice.mockResolvedValue({ settled: false });

      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'test_hash_unsettled',
        status: 'UNPAID',
      });

      const req = buildWebhookRequest({ payment_hash: payment.paymentHash });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ received: true });

      const unchanged = await db.lightningPayment.findUnique({
        where: { paymentHash: payment.paymentHash },
      });
      expect(unchanged!.status).toBe('UNPAID');

      const tx = await db.workspaceTransaction.findFirst({
        where: { lightningPaymentId: payment.id },
      });
      expect(tx).toBeNull();
    });

    test('updates matching UNPAID payment to PAID and returns { received: true }', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'test_hash_settled_123',
        status: 'UNPAID',
      });

      const req = buildWebhookRequest({ payment_hash: payment.paymentHash });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ received: true });

      const updated = await db.lightningPayment.findUnique({
        where: { paymentHash: payment.paymentHash },
      });
      expect(updated!.status).toBe('PAID');
    });

    test('creates WorkspaceTransaction with populated workspaceId for authenticated flow', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'test_hash_auth_tx',
        status: 'UNPAID',
        amount: 200_000_000, // 2 BTC
      });

      mockFetchBtcPriceUsd.mockResolvedValue(50000);

      const req = buildWebhookRequest({ payment_hash: payment.paymentHash });
      await POST(req);

      const tx = await db.workspaceTransaction.findUnique({
        where: { lightningPaymentId: payment.id },
      });
      expect(tx).not.toBeNull();
      expect(tx!.workspaceId).toBe(workspace.id);
      expect(tx!.type).toBe('LIGHTNING');
      expect(tx!.amountSats).toBe(200_000_000);
      expect(tx!.btcPriceUsd).toBe(50000);
      expect(tx!.amountUsd).toBeCloseTo(100000);
      expect(tx!.lightningPaymentId).toBe(payment.id);
    });

    test('creates WorkspaceTransaction with null workspaceId for pre-auth flow', async () => {
      const payment = await createTestLightningPayment({
        workspaceName: 'Pre-Auth Workspace',
        workspaceSlug: 'pre-auth-ws',
        paymentHash: 'test_hash_preauth_tx',
        status: 'UNPAID',
        amount: 100_000_000,
      });

      mockFetchBtcPriceUsd.mockResolvedValue(60000);

      const req = buildWebhookRequest({ payment_hash: payment.paymentHash });
      await POST(req);

      const tx = await db.workspaceTransaction.findUnique({
        where: { lightningPaymentId: payment.id },
      });
      expect(tx).not.toBeNull();
      expect(tx!.workspaceId).toBeNull();
      expect(tx!.type).toBe('LIGHTNING');
      expect(tx!.amountSats).toBe(100_000_000);
      expect(tx!.btcPriceUsd).toBe(60000);
      expect(tx!.amountUsd).toBeCloseTo(60000);
    });

    test('creates WorkspaceTransaction with null amountUsd when BTC price fetch fails', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'test_hash_no_price',
        status: 'UNPAID',
        amount: 50_000_000,
      });

      mockFetchBtcPriceUsd.mockResolvedValue(null);

      const req = buildWebhookRequest({ payment_hash: payment.paymentHash });
      const response = await POST(req);

      expect(response.status).toBe(200);

      const tx = await db.workspaceTransaction.findUnique({
        where: { lightningPaymentId: payment.id },
      });
      expect(tx).not.toBeNull();
      expect(tx!.btcPriceUsd).toBeNull();
      expect(tx!.amountUsd).toBeNull();
      expect(tx!.amountSats).toBe(50_000_000);
    });

    test('does not create duplicate WorkspaceTransaction if webhook fires twice', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'test_hash_idempotent',
        status: 'UNPAID',
      });

      const req1 = buildWebhookRequest({ payment_hash: payment.paymentHash });
      await POST(req1);

      // Second fire — unique constraint on lightningPaymentId prevents duplicate
      const req2 = buildWebhookRequest({ payment_hash: payment.paymentHash });
      const response2 = await POST(req2);

      expect(response2.status).toBe(200);

      const txns = await db.workspaceTransaction.findMany({
        where: { lightningPaymentId: payment.id },
      });
      expect(txns).toHaveLength(1);
    });

    test('returns 200 with { received: true } for unknown payment_hash (no-op)', async () => {
      const req = buildWebhookRequest({ payment_hash: 'unknown_hash_xyz' });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ received: true });
    });

    test('returns 200 with { received: true } when payment_hash is missing from body', async () => {
      const req = buildWebhookRequest({});
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ received: true });
    });
  });
});
