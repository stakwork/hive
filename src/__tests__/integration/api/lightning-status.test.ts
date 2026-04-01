import { describe, test, expect, beforeEach, vi } from 'vitest';
import { GET } from '@/app/api/lightning/invoice/status/route';
import { createTestWorkspaceScenario } from '@/__tests__/support/factories/workspace.factory';
import { createTestLightningPayment } from '@/__tests__/support/factories/lightning-payment.factory';
import { createGetRequest } from '@/__tests__/support/helpers/request-builders';

describe('Lightning Invoice Status API Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/lightning/invoice/status', () => {
    test('returns UNPAID status for an existing UNPAID payment', async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const payment = await createTestLightningPayment({
        workspaceId: workspace.id,
        paymentHash: 'status_test_hash_unpaid',
        status: 'UNPAID',
      });

      const req = createGetRequest('/api/lightning/invoice/status', { paymentHash: payment.paymentHash });
      const response = await GET(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('UNPAID');
    });

    test('returns PAID status for a PAID payment', async () => {
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
    });

    test('returns status for a pre-auth payment (null workspaceId)', async () => {
      const payment = await createTestLightningPayment({
        workspaceName: 'My Graph',
        workspaceSlug: 'my-graph',
        paymentHash: 'status_test_hash_preauth',
        status: 'UNPAID',
      });

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
  });
});
