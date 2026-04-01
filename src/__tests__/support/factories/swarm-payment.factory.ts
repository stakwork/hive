import { db } from '@/lib/db';
import type { SwarmPayment, SwarmPaymentStatus } from '@prisma/client';

export interface CreateTestSwarmPaymentOptions {
  workspaceId: string;
  stripeSessionId?: string;
  stripePaymentIntentId?: string | null;
  status?: SwarmPaymentStatus;
  amount?: number | null;
  currency?: string | null;
}

export async function createTestSwarmPayment(
  options: CreateTestSwarmPaymentOptions,
): Promise<SwarmPayment> {
  const timestamp = Date.now();
  const uniqueId = Math.random().toString(36).substring(7);

  return db.swarmPayment.create({
    data: {
      workspaceId: options.workspaceId,
      stripeSessionId: options.stripeSessionId ?? `cs_test_${timestamp}_${uniqueId}`,
      stripePaymentIntentId: options.stripePaymentIntentId ?? null,
      status: options.status ?? 'PENDING',
      amount: options.amount ?? null,
      currency: options.currency ?? null,
    },
  });
}
