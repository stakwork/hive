-- AlterTable
ALTER TABLE "whiteboards" ADD COLUMN     "feature_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "whiteboards_feature_id_key" ON "whiteboards"("feature_id");

-- AddForeignKey
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;
