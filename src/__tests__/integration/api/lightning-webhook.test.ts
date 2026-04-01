import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/lightning/webhook/route';
import { db } from '@/lib/db';
import { createTestWorkspaceScenario } from '@/__tests__/support/factories/workspace.factory';
import { createTestLightningPayment } from '@/__tests__/support/factories/lightning-payment.factory';
import { NextRequest } from 'next/server';

function buildWebhookRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/lightning/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Lightning Webhook Handler Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/lightning/webhook', () => {
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
