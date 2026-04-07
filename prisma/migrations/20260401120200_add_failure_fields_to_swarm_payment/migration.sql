-- AlterTable (idempotent: works on swarm_payments or fiat_payments)
DO $$
DECLARE tbl TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'swarm_payments' AND table_schema = 'public') THEN
    tbl := 'swarm_payments';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fiat_payments' AND table_schema = 'public') THEN
    tbl := 'fiat_payments';
  ELSE
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = tbl AND column_name = 'failure_code') THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN "failure_code" TEXT', tbl);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = tbl AND column_name = 'failure_message') THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN "failure_message" TEXT', tbl);
  END IF;
END $$;

-- CreateIndex (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'swarm_payments_stripe_payment_intent_id_idx')
     AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'fiat_payments_stripe_payment_intent_id_idx') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'swarm_payments' AND table_schema = 'public') THEN
      CREATE INDEX "swarm_payments_stripe_payment_intent_id_idx" ON "swarm_payments"("stripe_payment_intent_id");
    ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fiat_payments' AND table_schema = 'public') THEN
      CREATE INDEX "fiat_payments_stripe_payment_intent_id_idx" ON "fiat_payments"("stripe_payment_intent_id");
    END IF;
  END IF;
END $$;
