-- All statements are guarded: this migration is a no-op when the
-- "connections" table does not exist (e.g. on a fresh CI DB that never
-- had a prior partial run of 20260411162658_add_connection_model).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'connections'
  ) THEN
    -- Add slug column if not already present
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'connections' AND column_name = 'slug'
    ) THEN
      ALTER TABLE "connections" ADD COLUMN "slug" TEXT NOT NULL DEFAULT '';
    END IF;

    -- Backfill slug from id
    UPDATE "connections" SET "slug" = "id" WHERE "slug" = '';

    -- Drop the transient default
    ALTER TABLE "connections" ALTER COLUMN "slug" DROP DEFAULT;

    -- Create unique index if not already present
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'connections' AND indexname = 'connections_org_id_slug_key'
    ) THEN
      CREATE UNIQUE INDEX "connections_org_id_slug_key" ON "connections"("org_id", "slug");
    END IF;
  END IF;
END $$;
