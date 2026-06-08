-- AlterTable (idempotent: no-op if connections table or column already exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'connections'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'connections' AND column_name = 'architecture'
    ) THEN
      ALTER TABLE "connections" ADD COLUMN "architecture" TEXT;
    END IF;
  END IF;
END $$;
