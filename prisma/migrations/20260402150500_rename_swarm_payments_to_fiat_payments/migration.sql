-- Idempotent rename: swarm_payments → fiat_payments
-- Safe to run on fresh DBs (table never existed) or already-renamed DBs

DO $$
BEGIN
  -- Rename table if still under old name
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'swarm_payments' AND table_schema = 'public')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fiat_payments' AND table_schema = 'public') THEN
    ALTER TABLE "swarm_payments" RENAME TO "fiat_payments";
  END IF;

  -- Rename primary key constraint
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swarm_payments_pkey') THEN
    ALTER TABLE "fiat_payments" RENAME CONSTRAINT "swarm_payments_pkey" TO "fiat_payments_pkey";
  END IF;

  -- Rename foreign key constraints on fiat_payments
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swarm_payments_workspace_id_fkey') THEN
    ALTER TABLE "fiat_payments" RENAME CONSTRAINT "swarm_payments_workspace_id_fkey" TO "fiat_payments_workspace_id_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swarm_payments_user_id_fkey') THEN
    ALTER TABLE "fiat_payments" RENAME CONSTRAINT "swarm_payments_user_id_fkey" TO "fiat_payments_user_id_fkey";
  END IF;

  -- Rename foreign key constraint on workspace_transactions
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_transactions_swarm_payment_id_fkey') THEN
    ALTER TABLE "workspace_transactions" RENAME CONSTRAINT "workspace_transactions_swarm_payment_id_fkey" TO "workspace_transactions_fiat_payment_id_fkey";
  END IF;

  -- Rename column on workspace_transactions
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workspace_transactions' AND column_name = 'swarm_payment_id') THEN
    ALTER TABLE "workspace_transactions" RENAME COLUMN "swarm_payment_id" TO "fiat_payment_id";
  END IF;

  -- Rename enum
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SwarmPaymentStatus') THEN
    ALTER TYPE "SwarmPaymentStatus" RENAME TO "FiatPaymentStatus";
  END IF;
END $$;

-- Rename indexes (cannot be done inside a DO block, use IF EXISTS via separate statements)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'swarm_payments_stripe_session_id_key') THEN
    ALTER INDEX "swarm_payments_stripe_session_id_key" RENAME TO "fiat_payments_stripe_session_id_key";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'swarm_payments_workspace_id_idx') THEN
    ALTER INDEX "swarm_payments_workspace_id_idx" RENAME TO "fiat_payments_workspace_id_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'swarm_payments_stripe_session_id_idx') THEN
    ALTER INDEX "swarm_payments_stripe_session_id_idx" RENAME TO "fiat_payments_stripe_session_id_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'swarm_payments_stripe_payment_intent_id_idx') THEN
    ALTER INDEX "swarm_payments_stripe_payment_intent_id_idx" RENAME TO "fiat_payments_stripe_payment_intent_id_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'swarm_payments_user_id_idx') THEN
    ALTER INDEX "swarm_payments_user_id_idx" RENAME TO "fiat_payments_user_id_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'workspace_transactions_swarm_payment_id_key') THEN
    ALTER INDEX "workspace_transactions_swarm_payment_id_key" RENAME TO "workspace_transactions_fiat_payment_id_key";
  END IF;
END $$;
