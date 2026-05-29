-- AlterTable
ALTER TABLE "features" ADD COLUMN "depends_on_feature_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
