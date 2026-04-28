-- AlterTable
ALTER TABLE "features" ADD COLUMN     "initiative_id" TEXT;

-- CreateIndex
CREATE INDEX "features_initiative_id_idx" ON "features"("initiative_id");

-- AddForeignKey
ALTER TABLE "features" ADD CONSTRAINT "features_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;
