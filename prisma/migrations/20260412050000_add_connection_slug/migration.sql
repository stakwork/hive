-- AlterTable
ALTER TABLE IF EXISTS "connections" ADD COLUMN IF NOT EXISTS "slug" TEXT NOT NULL DEFAULT '';

-- Update existing rows to use a generated slug
UPDATE "connections" SET "slug" = "id" WHERE "slug" = '' AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'connections');

-- Remove default
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'connections' AND column_name = 'slug') THEN
    ALTER TABLE "connections" ALTER COLUMN "slug" DROP DEFAULT;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "connections_org_id_slug_key" ON "connections"("org_id", "slug");
