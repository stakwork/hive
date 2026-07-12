-- AlterEnum (idempotent: adds LEGAL_BENCHMARK_EVAL only if it does not already exist)
-- This migration may run after 20260712161930 which added the same value; the
-- IF NOT EXISTS guard prevents the "enum label already exists" (42710) error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'LEGAL_BENCHMARK_EVAL'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'StakworkRunType')
  ) THEN
    ALTER TYPE "StakworkRunType" ADD VALUE 'LEGAL_BENCHMARK_EVAL';
  END IF;
END$$;
