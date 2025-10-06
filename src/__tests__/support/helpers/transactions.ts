import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * Wraps test data creation in a transaction for atomicity
 *
 * @example
 * const testData = await createTestData(async (tx) => {
 *   const user = await tx.user.create({ data: {...} });
 *   const workspace = await tx.workspace.create({ data: {...} });
 *   return { user, workspace };
 * });
 */
export async function createTestData<T>(
  factory: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return db.$transaction(factory);
}