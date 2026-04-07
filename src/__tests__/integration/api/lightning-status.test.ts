import { describe, test, expect, beforeEach, vi } from 'vitest';
import { GET } from '@/app/api/lightning/invoice/status/route';
import { db } from '@/lib/db';
import { createTestWorkspaceScenario } from '@/__tests__/support/factories/workspace.factory';
import { createTestLightningPayment } from '@/__tests__/support/factories/lightning-payment.factory';
import { createGetRequest } from '@/__tests__/support/helpers/request-builders';

vi.mock('@/services/lightning', () => ({
  lookupLndInvoice: vi.fn(),
}));

vi.mock('@/lib/btc-price', () => ({
  fetchBtcPriceUsd: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  getClientIp: vi.fn().mockReturnValue('1.2.3.4'),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { lookupLndInvoice } from '@/services/lightning';
import { fetchBtcPriceUsd } from '@/lib/btc-price';
import { checkRateLimit } from '@/lib/rate-limit';

const mockLookupLndInvoice = vi.mocked(lookupLndInvoice);
const mockFetchBtcPriceUsd = vi.mocked(fetchBtcPriceUsd);

describe('Lightning Invoice Status API Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchBtcPriceUsd.mockResolvedValue(50000);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true });
  });

  describe('GET /api/lightning/invoice/status', () => {
    test('returns UNPAID status for an existing UNPAID payment when LND returns unsettled', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'status_test_hash_unpaid',
        status: 'UNPAID',
      });

      mockLookupLndInvoice.mockResolvedValue({ settled: false });

      const req = createGetRequest('/api/lightning/invoice/status', { paymentHash: payment.paymentHash });
      const response = await GET(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('UNPAID');
    });

    test('returns PAID status for a PAID payment without calling LND', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'status_test_hash_paid',
        status: 'PAID',
      });

      const req = createGetRequest('/api/lightning/invoice/status', { paymentHash: payment.paymentHash });
      const response = await GET(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('PAID');
      expect(mockLookupLndInvoice).not.toHaveBeenCalled();
    });

    test('UNPAID + LND returns settled: true → response PAID, DB updated, WorkspaceTransaction created', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'status_test_hash_lnd_settled',
        status: 'UNPAID',
        amount: 100_000_000,
      });

      mockLookupLndInvoice.mockResolvedValue({ settled: true });
      mockFetchBtcPriceUsd.mockResolvedValue(50000);

      const req = createGetRequest('/api/lightning/invoice/status', { paymentHash: payment.paymentHash });
      const response = await GET(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('PAID');

      // DB record updated
      const updated = await db.lightningPayment.findUnique({
        where: { paymentHash: payment.paymentHash },
      });
      expect(updated!.status).toBe('PAID');

      // WorkspaceTransaction created
      const tx = await db.workspaceTransaction.findUnique({
        where: { lightningPaymentId: payment.id },
      });
      expect(tx).not.toBeNull();
      expect(tx!.workspaceId).toBe(workspace.id);
      expect(tx!.type).toBe('LIGHTNING');
      expect(tx!.amountSats).toBe(100_000_000);
      expect(tx!.btcPriceUsd).toBe(50000);
      expect(tx!.amountUsd).toBeCloseTo(50000);
    });

    test('UNPAID + LND returns settled: true for pre-auth (null workspaceId) → WorkspaceTransaction with null workspaceId', async () => {
      const payment = await createTestLightningPayment({
        workspaceName: 'Pre-Auth Workspace',
        workspaceSlug: 'pre-auth-ws',
        paymentHash: 'status_test_hash_preauth_settled',
        status: 'UNPAID',
        amount: 50_000_000,
      });

      mockLookupLndInvoice.mockResolvedValue({ settled: true });
      mockFetchBtcPriceUsd.mockResolvedValue(60000);

      const req = createGetRequest('/api/lightning/invoice/status', { paymentHash: payment.paymentHash });
      const response = await GET(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('PAID');

      const tx = await db.workspaceTransaction.findUnique({
        where: { lightningPaymentId: payment.id },
      });
      expect(tx).not.toBeNull();
      expect(tx!.workspaceId).toBeNull();
      expect(tx!.amountSats).toBe(50_000_000);
    });

    test('UNPAID + LND throws (unreachable) → response UNPAID, DB unchanged', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'status_test_hash_lnd_error',
        status: 'UNPAID',
      });

      mockLookupLndInvoice.mockRejectedValue(new Error('ECONNREFUSED'));

      const req = createGetRequest('/api/lightning/invoice/status', { paymentHash: payment.paymentHash });
      const response = await GET(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('UNPAID');

      // DB unchanged
      const unchanged = await db.lightningPayment.findUnique({
        where: { paymentHash: payment.paymentHash },
      });
      expect(unchanged!.status).toBe('UNPAID');

      // No transaction created
      const tx = await db.workspaceTransaction.findUnique({
        where: { lightningPaymentId: payment.id },
      });
      expect(tx).toBeNull();
    });

    test('UNPAID + LND returns settled: false → response UNPAID, DB unchanged', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'status_test_hash_lnd_unsettled',
        status: 'UNPAID',
      });

      mockLookupLndInvoice.mockResolvedValue({ settled: false });

      const req = createGetRequest('/api/lightning/invoice/status', { paymentHash: payment.paymentHash });
      const response = await GET(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('UNPAID');

      const unchanged = await db.lightningPayment.findUnique({
        where: { paymentHash: payment.paymentHash },
      });
      expect(unchanged!.status).toBe('UNPAID');
    });

    test('returns status for a pre-auth payment (null workspaceId) when LND unsettled', async () => {
      const payment = await createTestLightningPayment({
        workspaceName: 'My Graph',
        workspaceSlug: 'my-graph',
        paymentHash: 'status_test_hash_preauth',
        status: 'UNPAID',
      });

      mockLookupLndInvoice.mockResolvedValue({ settled: false });

      const req = createGetRequest('/api/lightning/invoice/status', { paymentHash: payment.paymentHash });
      const response = await GET(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('UNPAID');
    });

    test('returns 404 for unknown paymentHash', async () => {
      const req = createGetRequest('/api/lightning/invoice/status', { paymentHash: 'nonexistent_hash_xyz' });
      const response = await GET(req);

      expect(response.status).toBe(404);
    });

    test('returns 400 when paymentHash query param is missing', async () => {
      const req = createGetRequest('/api/lightning/invoice/status');
      const response = await GET(req);

      expect(response.status).toBe(400);
    });

    test('returns 429 when per-IP rate limit is exceeded', async () => {
      vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfter: 30 });

      const req = createGetRequest('/api/lightning/invoice/status', { paymentHash: 'some_hash' });
      const response = await GET(req);
      expect(response.status).toBe(429);
      const data = await response.json();
      expect(data.error).toBe('Too many requests');
    });

    test('UNPAID + LND settled + BTC price null → WorkspaceTransaction with null amountUsd', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'status_test_hash_no_price',
        status: 'UNPAID',
        amount: 200_000_000,
      });

      mockLookupLndInvoice.mockResolvedValue({ settled: true });
      mockFetchBtcPriceUsd.mockResolvedValue(null);

      const req = createGetRequest('/api/lightning/invoice/status', { paymentHash: payment.paymentHash });
      const response = await GET(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('PAID');

      const tx = await db.workspaceTransaction.findUnique({
        where: { lightningPaymentId: payment.id },
      });
      expect(tx).not.toBeNull();
      expect(tx!.btcPriceUsd).toBeNull();
      expect(tx!.amountUsd).toBeNull();
    });
  });
});
