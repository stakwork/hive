-- AlterTable (idempotent: skip if column already exists)
ALTER TABLE "connections" ADD COLUMN IF NOT EXISTS "slug" TEXT NOT NULL DEFAULT '';

-- Update existing rows that still have the empty-string placeholder
UPDATE "connections" SET "slug" = "id" WHERE "slug" = '';

-- Remove default (idempotent: only drop if the default is still set)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'connections'
      AND column_name = 'slug'
      AND column_default IS NOT NULL
  ) THEN
    ALTER TABLE "connections" ALTER COLUMN "slug" DROP DEFAULT;
  END IF;
END$$;

-- CreateIndex (idempotent: skip if index already exists)
CREATE UNIQUE INDEX IF NOT EXISTS "connections_org_id_slug_key" ON "connections"("org_id", "slug");
