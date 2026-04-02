-- Drop/re-add FK with SET NULL (idempotent: works on swarm_payments or fiat_payments)
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

  -- Drop old FK if it exists (either name)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tbl || '_workspace_id_fkey') THEN
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, tbl || '_workspace_id_fkey');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swarm_payments_workspace_id_fkey') THEN
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT "swarm_payments_workspace_id_fkey"', tbl);
  END IF;

  -- Re-add FK as nullable with SET NULL on delete
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tbl || '_workspace_id_fkey') THEN
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE',
      tbl, tbl || '_workspace_id_fkey'
    );
  END IF;
END $$;
