import { db } from '@/lib/db';
import type { LightningPayment, LightningPaymentStatus } from '@prisma/client';

export interface CreateTestLightningPaymentOptions {
  workspaceId?: string;
  workspaceName?: string;
  workspaceSlug?: string;
  paymentHash?: string;
  invoice?: string;
  amount?: number;
  status?: LightningPaymentStatus;
}

export async function createTestLightningPayment(
  options: CreateTestLightningPaymentOptions,
): Promise<LightningPayment> {
  const rand = Math.random().toString(36).substring(7);
  return db.lightningPayment.create({
    data: {
      workspaceId: options.workspaceId ?? null,
      workspaceName: options.workspaceName ?? null,
      workspaceSlug: options.workspaceSlug ?? null,
      paymentHash: options.paymentHash ?? `mock_hash_${rand}`,
      invoice: options.invoice ?? `lnbc1mock_${rand}`,
      amount: options.amount ?? 1000,
      status: options.status ?? 'UNPAID',
    },
  });
}
