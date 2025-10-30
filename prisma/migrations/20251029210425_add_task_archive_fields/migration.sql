-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "archived_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "tasks_archived_idx" ON "tasks"("archived");
