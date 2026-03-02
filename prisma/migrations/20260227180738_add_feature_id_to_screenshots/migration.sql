-- AlterTable
ALTER TABLE "screenshots" ADD COLUMN     "feature_id" TEXT;

-- CreateIndex
CREATE INDEX "screenshots_feature_id_idx" ON "screenshots"("feature_id");

-- AddForeignKey
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;
