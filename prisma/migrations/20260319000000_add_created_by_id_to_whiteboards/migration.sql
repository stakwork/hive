-- AlterTable
ALTER TABLE "whiteboards" ADD COLUMN "created_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "whiteboards_created_by_id_idx" ON "whiteboards"("created_by_id");
