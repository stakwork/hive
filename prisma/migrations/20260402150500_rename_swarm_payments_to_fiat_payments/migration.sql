-- Rename table
ALTER TABLE "swarm_payments" RENAME TO "fiat_payments";

-- Rename primary key constraint
ALTER TABLE "fiat_payments" RENAME CONSTRAINT "swarm_payments_pkey" TO "fiat_payments_pkey";

-- Rename unique index
ALTER INDEX "swarm_payments_stripe_session_id_key" RENAME TO "fiat_payments_stripe_session_id_key";

-- Rename indexes
ALTER INDEX "swarm_payments_workspace_id_idx" RENAME TO "fiat_payments_workspace_id_idx";
ALTER INDEX "swarm_payments_stripe_session_id_idx" RENAME TO "fiat_payments_stripe_session_id_idx";
ALTER INDEX "swarm_payments_stripe_payment_intent_id_idx" RENAME TO "fiat_payments_stripe_payment_intent_id_idx";
ALTER INDEX "swarm_payments_user_id_idx" RENAME TO "fiat_payments_user_id_idx";

-- Rename foreign key constraints on fiat_payments
ALTER TABLE "fiat_payments" RENAME CONSTRAINT "swarm_payments_workspace_id_fkey" TO "fiat_payments_workspace_id_fkey";
ALTER TABLE "fiat_payments" RENAME CONSTRAINT "swarm_payments_user_id_fkey" TO "fiat_payments_user_id_fkey";

-- Rename foreign key constraint on workspace_transactions
ALTER TABLE "workspace_transactions" RENAME CONSTRAINT "workspace_transactions_swarm_payment_id_fkey" TO "workspace_transactions_fiat_payment_id_fkey";

-- Rename unique index on workspace_transactions
ALTER INDEX "workspace_transactions_swarm_payment_id_key" RENAME TO "workspace_transactions_fiat_payment_id_key";

-- Rename column on workspace_transactions
ALTER TABLE "workspace_transactions" RENAME COLUMN "swarm_payment_id" TO "fiat_payment_id";

-- Rename enum
ALTER TYPE "SwarmPaymentStatus" RENAME TO "FiatPaymentStatus";
