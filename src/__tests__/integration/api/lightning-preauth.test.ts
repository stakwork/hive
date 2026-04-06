import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/lightning/invoice/preauth/route';
import { db } from '@/lib/db';
import { createPostRequest } from '@/__tests__/support/helpers/request-builders';
import { upsertTestPlatformConfig } from '@/__tests__/support/factories';

vi.mock('@/services/lightning', () => ({
  createLndInvoice: vi.fn().mockResolvedValue({
    payment_hash: 'mock_preauth_hash_abc',
    payment_request: 'lnbc500000umock_preauth_abc',
  }),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
  },
}));

vi.mock('@/lib/btc-price', () => ({
  fetchBtcPriceUsd: vi.fn().mockResolvedValue(100000),
}));

// Expected sats: Math.round((50 / 100000) * 1e8) = 50000
const EXPECTED_SATS = 50000;

describe('Lightning Pre-auth Invoice API Integration Tests', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-apply the default mock after clearAllMocks
    const { fetchBtcPriceUsd } = await import('@/lib/btc-price');
    vi.mocked(fetchBtcPriceUsd).mockResolvedValue(100000);

    await upsertTestPlatformConfig('graphmindsetAmountUsd', '50');
  });

  describe('POST /api/lightning/invoice/preauth', () => {
    test('creates LightningPayment with null workspaceId and returns invoice + qrCodeDataUrl', async () => {
      const req = createPostRequest('/api/lightning/invoice/preauth', {
        workspaceName: 'My Graph',
        workspaceSlug: 'my-graph',
      });
      const response = await POST(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.invoice).toBe('lnbc500000umock_preauth_abc');
      expect(data.paymentHash).toBe('mock_preauth_hash_abc');
      expect(data.amount).toBe(EXPECTED_SATS);
      expect(data.qrCodeDataUrl).toBe('data:image/png;base64,mockqr');

      const payment = await db.lightningPayment.findUnique({
        where: { paymentHash: 'mock_preauth_hash_abc' },
      });
      expect(payment).not.toBeNull();
      expect(payment!.workspaceId).toBeNull();
      expect(payment!.workspaceName).toBe('My Graph');
      expect(payment!.workspaceSlug).toBe('my-graph');
      expect(payment!.status).toBe('UNPAID');
      expect(payment!.amount).toBe(EXPECTED_SATS);

      const pendingRecord = await db.lightningPayment.findFirst({
        where: { paymentHash: { startsWith: 'pending_' } },
      });
      expect(pendingRecord).toBeNull();
    });

    test('amount stored in LightningPayment matches calculated sats value', async () => {
      // Use a different BTC price to verify the formula
      const { fetchBtcPriceUsd } = await import('@/lib/btc-price');
      vi.mocked(fetchBtcPriceUsd).mockResolvedValueOnce(50000);
      // Expected: Math.round((50 / 50000) * 1e8) = 100000 sats

      const req = createPostRequest('/api/lightning/invoice/preauth', {
        workspaceName: 'Sats Check',
        workspaceSlug: 'sats-check',
      });
      const response = await POST(req);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.amount).toBe(100000);

      const payment = await db.lightningPayment.findUnique({
        where: { paymentHash: 'mock_preauth_hash_abc' },
      });
      expect(payment!.amount).toBe(100000);
    });

    test('returns 503 when PlatformConfig record is missing', async () => {
      await db.platformConfig.deleteMany({ where: { key: 'graphmindsetAmountUsd' } });

      const req = createPostRequest('/api/lightning/invoice/preauth', {
        workspaceName: 'My Graph',
        workspaceSlug: 'my-graph',
      });
      const response = await POST(req);
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toBe('Payment price not configured');
    });

    test('returns 503 when fetchBtcPriceUsd throws', async () => {
      const { fetchBtcPriceUsd } = await import('@/lib/btc-price');
      vi.mocked(fetchBtcPriceUsd).mockRejectedValueOnce(new Error('mempool.space unavailable'));

      const req = createPostRequest('/api/lightning/invoice/preauth', {
        workspaceName: 'My Graph',
        workspaceSlug: 'my-graph',
      });
      const response = await POST(req);
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toBe('BTC price unavailable, please try again');
    });

    test('returns 400 when workspaceName is missing', async () => {
      const req = createPostRequest('/api/lightning/invoice/preauth', {
        workspaceSlug: 'my-graph',
      });
      const response = await POST(req);
      expect(response.status).toBe(400);
    });

    test('returns 400 when workspaceSlug is missing', async () => {
      const req = createPostRequest('/api/lightning/invoice/preauth', {
        workspaceName: 'My Graph',
      });
      const response = await POST(req);
      expect(response.status).toBe(400);
    });

    test('returns 400 when body is empty', async () => {
      const req = createPostRequest('/api/lightning/invoice/preauth', {});
      const response = await POST(req);
      expect(response.status).toBe(400);
    });

    test('returns 500 when LND invoice creation fails', async () => {
      const { createLndInvoice } = await import('@/services/lightning');
      vi.mocked(createLndInvoice).mockRejectedValueOnce(new Error('LND connection refused'));

      const req = createPostRequest('/api/lightning/invoice/preauth', {
        workspaceName: 'My Graph',
        workspaceSlug: 'my-graph',
      });
      const response = await POST(req);
      expect(response.status).toBe(500);

      const placeholder = await db.lightningPayment.findFirst({
        where: { paymentHash: { startsWith: 'pending_' } },
      });
      expect(placeholder).not.toBeNull();
      expect(placeholder!.invoice).toBe('');
      expect(placeholder!.status).toBe('UNPAID');
    });
  });
});
