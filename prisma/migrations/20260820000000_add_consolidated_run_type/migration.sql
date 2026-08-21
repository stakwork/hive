-- AlterEnum
-- Guard against duplicate-enum errors (PostgreSQL 42710) when this migration
-- runs after LEGAL_BENCHMARK_CONSOLIDATED was already added by another path.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'LEGAL_BENCHMARK_CONSOLIDATED'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'StakworkRunType')
  ) THEN
    ALTER TYPE "StakworkRunType" ADD VALUE 'LEGAL_BENCHMARK_CONSOLIDATED';
  END IF;
END $$;
