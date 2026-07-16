-- AlterTable: make workspace_id nullable and add workspace_name/workspace_slug
-- Written idempotently so a retry after a partial failure succeeds cleanly.

-- Drop NOT NULL constraint only if the column is still non-nullable
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lightning_payments'
      AND column_name = 'workspace_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "lightning_payments" ALTER COLUMN "workspace_id" DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE "lightning_payments" ADD COLUMN IF NOT EXISTS "workspace_name" TEXT;
ALTER TABLE "lightning_payments" ADD COLUMN IF NOT EXISTS "workspace_slug" TEXT;
