-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "janitor_type" "JanitorType";

-- CreateIndex
CREATE INDEX "tasks_janitor_type_idx" ON "tasks"("janitor_type");
