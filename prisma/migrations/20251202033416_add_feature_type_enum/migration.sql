-- CreateEnum
CREATE TYPE "FeatureType" AS ENUM ('FEATURE', 'BUG');

-- AlterTable
ALTER TABLE "features" ADD COLUMN     "featureType" "FeatureType" NOT NULL DEFAULT 'FEATURE';

-- CreateIndex
CREATE INDEX "features_featureType_idx" ON "features"("featureType");
