-- AlterTable
ALTER TABLE "screenshots" ADD COLUMN IF NOT EXISTS "feature_id" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "screenshots_feature_id_idx" ON "screenshots"("feature_id");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'screenshots_feature_id_fkey'
      AND table_name = 'screenshots'
  ) THEN
    ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_feature_id_fkey"
      FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
