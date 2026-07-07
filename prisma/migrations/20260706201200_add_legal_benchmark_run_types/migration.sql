-- Migration 1 of 2: Add LEGAL_BENCHMARK_RUNNER/SCORER to StakworkRunType enum
--
-- These enum values must be committed in their own transaction before they can
-- be referenced in a WHERE clause of a partial index (Postgres restriction:
-- "unsafe use of new value of enum type" error if used in same transaction).
-- The partial expression index is added in the next migration (20260706201300).

ALTER TYPE "StakworkRunType" ADD VALUE 'LEGAL_BENCHMARK_RUNNER';
ALTER TYPE "StakworkRunType" ADD VALUE 'LEGAL_BENCHMARK_SCORER';
