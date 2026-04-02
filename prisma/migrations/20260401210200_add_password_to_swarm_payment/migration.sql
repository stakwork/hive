-- Add password column (idempotent: works on swarm_payments or fiat_payments)
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

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = tbl AND column_name = 'password') THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN "password" TEXT', tbl);
  END IF;
END $$;
