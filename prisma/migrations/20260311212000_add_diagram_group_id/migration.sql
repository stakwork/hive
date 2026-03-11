-- Add group_id column to diagrams with backfill and index
ALTER TABLE "diagrams" ADD COLUMN "group_id" TEXT NOT NULL DEFAULT '';
UPDATE "diagrams" SET "group_id" = "id" WHERE "group_id" = '';
ALTER TABLE "diagrams" ALTER COLUMN "group_id" DROP DEFAULT;
CREATE INDEX "diagrams_group_id_idx" ON "diagrams"("group_id");
-- Restore default for Prisma compatibility
ALTER TABLE "diagrams" ALTER COLUMN "group_id" SET DEFAULT '';
