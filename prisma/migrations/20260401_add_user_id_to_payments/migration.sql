-- Add user_id to swarm_payments/fiat_payments and lightning_payments (idempotent)
DO $$
DECLARE tbl TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'swarm_payments' AND table_schema = 'public') THEN
    tbl := 'swarm_payments';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fiat_payments' AND table_schema = 'public') THEN
    tbl := 'fiat_payments';
  ELSE
    tbl := NULL;
  END IF;

  IF tbl IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = tbl AND column_name = 'user_id') THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN "user_id" TEXT', tbl);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tbl || '_user_id_fkey') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE',
        tbl, tbl || '_user_id_fkey'
      );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = tbl || '_user_id_idx') THEN
      EXECUTE format('CREATE INDEX %I ON %I("user_id")', tbl || '_user_id_idx', tbl);
    END IF;
  END IF;
END $$;

-- lightning_payments user_id (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lightning_payments' AND column_name = 'user_id') THEN
    ALTER TABLE "lightning_payments" ADD COLUMN "user_id" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lightning_payments_user_id_fkey') THEN
    ALTER TABLE "lightning_payments"
      ADD CONSTRAINT "lightning_payments_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'lightning_payments_user_id_idx') THEN
    CREATE INDEX "lightning_payments_user_id_idx" ON "lightning_payments"("user_id");
  END IF;
END $$;
