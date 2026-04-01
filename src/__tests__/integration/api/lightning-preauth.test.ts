import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/lightning/invoice/preauth/route';
import { db } from '@/lib/db';
import { createPostRequest } from '@/__tests__/support/helpers/request-builders';

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

describe('Lightning Pre-auth Invoice API Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(data.amount).toBe(500000);
      expect(data.qrCodeDataUrl).toBe('data:image/png;base64,mockqr');

      const payment = await db.lightningPayment.findUnique({
        where: { paymentHash: 'mock_preauth_hash_abc' },
      });
      expect(payment).not.toBeNull();
      expect(payment!.workspaceId).toBeNull();
      expect(payment!.workspaceName).toBe('My Graph');
      expect(payment!.workspaceSlug).toBe('my-graph');
      expect(payment!.status).toBe('UNPAID');
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
    });
  });
});
