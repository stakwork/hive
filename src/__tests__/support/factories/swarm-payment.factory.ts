import { db } from '@/lib/db';
import type { SwarmPayment, SwarmPaymentStatus } from '@prisma/client';
import { EncryptionService } from '@/lib/encryption';
import { generateSecurePassword } from '@/lib/utils/password';

const encryptionService = EncryptionService.getInstance();

export interface CreateTestSwarmPaymentOptions {
  workspaceId?: string;
  workspaceName?: string;
  workspaceSlug?: string;
  stripeSessionId?: string;
  stripePaymentIntentId?: string | null;
  status?: SwarmPaymentStatus;
  amount?: number | null;
  currency?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  userId?: string | null;
  /** Plaintext password; will be encrypted before storage if TOKEN_ENCRYPTION_KEY is set.
   *  Defaults to a generated secure password. Pass null to explicitly store no password. */
  password?: string | null;
}

export async function createTestSwarmPayment(
  options: CreateTestSwarmPaymentOptions,
): Promise<SwarmPayment> {
  const timestamp = Date.now();
  const uniqueId = Math.random().toString(36).substring(7);

  const createData: Parameters<typeof db.swarmPayment.create>[0]['data'] = {
    workspaceId: options.workspaceId ?? null,
    workspaceName: options.workspaceName ?? null,
    workspaceSlug: options.workspaceSlug ?? null,
    stripeSessionId: options.stripeSessionId ?? `cs_test_${timestamp}_${uniqueId}`,
    stripePaymentIntentId: options.stripePaymentIntentId ?? null,
    status: options.status ?? 'PENDING',
    amount: options.amount ?? null,
    currency: options.currency ?? null,
    failureCode: options.failureCode ?? null,
    failureMessage: options.failureMessage ?? null,
    userId: options.userId ?? null,
    password: null,
  };

  // Determine the plaintext password to use
  const plaintextPassword =
    'password' in options
      ? options.password  // explicitly provided (may be null)
      : generateSecurePassword(20); // default: always generate one

  if (plaintextPassword && process.env.TOKEN_ENCRYPTION_KEY) {
    createData.password = JSON.stringify(
      encryptionService.encryptField('swarmPaymentPassword', plaintextPassword)
    );
  }

  return db.swarmPayment.create({ data: createData });
}
