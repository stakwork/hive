-- Backfill Phase 1 for all features that don't have phases
-- This is a data migration to ensure all existing features have at least one phase
-- Safe to run multiple times (idempotent)

INSERT INTO "phases" (
  id,
  feature_id,
  name,
  description,
  status,
  "order",
  deleted,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  f.id,
  'Phase 1',
  NULL,
  'NOT_STARTED',
  0,
  false,
  NULL,
  NOW(),
  NOW()
FROM "features" f
WHERE f.deleted = false
  AND NOT EXISTS (
    SELECT 1
    FROM "phases" p
    WHERE p.feature_id = f.id
      AND p.deleted = false
  );
