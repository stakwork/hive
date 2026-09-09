-- AlterEnum
-- Add XAI as a first-class LlmProvider value (idempotent).
-- Only alter if the enum type exists (handles shadow DB scenario) and only
-- add the label if it isn't already present (handles preview-branch re-runs
-- and avoids Postgres 42710 "enum label already exists").
-- Mirrors the pattern in 20260124103308_add_pod_status_and_soft_delete.
--
-- One-way: Postgres cannot DROP an enum value. Walking this feature back
-- just means leaving an orphaned, unused label — no down-migration needed.
DO $$
DECLARE enum_oid OID;
BEGIN
  SELECT oid INTO enum_oid FROM pg_type WHERE typname = 'LlmProvider';

  IF enum_oid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'XAI' AND enumtypid = enum_oid
  ) THEN
    ALTER TYPE "LlmProvider" ADD VALUE 'XAI';
  END IF;
END $$;
