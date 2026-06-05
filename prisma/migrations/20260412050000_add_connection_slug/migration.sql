-- AlterTable + Index (idempotent: no-op if connections table or columns/index already exist)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'connections'
  ) THEN
    -- Add slug column if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'connections' AND column_name = 'slug'
    ) THEN
      ALTER TABLE "connections" ADD COLUMN "slug" TEXT NOT NULL DEFAULT '';
      UPDATE "connections" SET "slug" = "id" WHERE "slug" = '';
      ALTER TABLE "connections" ALTER COLUMN "slug" DROP DEFAULT;
    END IF;

    -- Create unique index if missing
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'connections' AND indexname = 'connections_org_id_slug_key'
    ) THEN
      CREATE UNIQUE INDEX "connections_org_id_slug_key" ON "connections"("org_id", "slug");
    END IF;
  END IF;
END $$;
