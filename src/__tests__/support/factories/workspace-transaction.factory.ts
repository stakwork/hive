import { db } from '@/lib/db';
import type { WorkspaceTransaction, WorkspaceTransactionType } from '@prisma/client';

export interface CreateTestWorkspaceTransactionOptions {
  workspaceId?: string | null;
  type?: WorkspaceTransactionType;
  amountSats?: number | null;
  btcPriceUsd?: number | null;
  amountUsd?: number | null;
  currency?: string | null;
  lightningPaymentId?: string | null;
  fiatPaymentId?: string | null;
}

export async function createTestWorkspaceTransaction(
  options: CreateTestWorkspaceTransactionOptions,
): Promise<WorkspaceTransaction> {
  return db.workspaceTransaction.create({
    data: {
      workspaceId: options.workspaceId ?? null,
      type: options.type ?? 'LIGHTNING',
      amountSats: options.amountSats ?? null,
      btcPriceUsd: options.btcPriceUsd ?? null,
      amountUsd: options.amountUsd ?? null,
      currency: options.currency ?? null,
      lightningPaymentId: options.lightningPaymentId ?? null,
      fiatPaymentId: options.fiatPaymentId ?? null,
    },
  });
}
