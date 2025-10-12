-- AlterTable
ALTER TABLE "features" ADD COLUMN     "deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "phases" ADD COLUMN     "deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "features_deleted_idx" ON "features"("deleted");

-- CreateIndex
CREATE INDEX "phases_deleted_idx" ON "phases"("deleted");

-- CreateIndex
CREATE INDEX "tickets_deleted_idx" ON "tickets"("deleted");
