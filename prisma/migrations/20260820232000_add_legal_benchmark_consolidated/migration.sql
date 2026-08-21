-- AlterEnum
-- LEGAL_BENCHMARK_CONSOLIDATED was already added by migration
-- 20260820000000_add_consolidated_run_type. This migration is a no-op to
-- avoid the "enum label already exists" error (PostgreSQL error 42710) when
-- both migrations are applied in sequence.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'LEGAL_BENCHMARK_CONSOLIDATED'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'StakworkRunType')
  ) THEN
    ALTER TYPE "StakworkRunType" ADD VALUE 'LEGAL_BENCHMARK_CONSOLIDATED';
  END IF;
END $$;
