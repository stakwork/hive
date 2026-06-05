-- AlterTable
ALTER TABLE IF EXISTS "connections" ADD COLUMN IF NOT EXISTS "slug" TEXT NOT NULL DEFAULT '';

-- Update existing rows to use a generated slug (only runs if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'connections') THEN
    UPDATE "connections" SET "slug" = "id" WHERE "slug" = '';
  END IF;
END $$;

-- Remove default (only if column exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'connections' AND column_name = 'slug') THEN
    ALTER TABLE "connections" ALTER COLUMN "slug" DROP DEFAULT;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "connections_org_id_slug_key" ON "connections"("org_id", "slug");
