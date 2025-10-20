/*
  Warnings:

  - You are about to drop the `tickets` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'BLOCKED';

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_assignee_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_feature_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_phase_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_updated_by_id_fkey";

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "depends_on_task_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "feature_id" TEXT,
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "phase_id" TEXT,
ADD COLUMN     "system_assignee_type" "SystemAssigneeType";

-- DropTable
DROP TABLE "tickets";

-- DropEnum
DROP TYPE "TicketStatus";

-- CreateIndex
CREATE INDEX "tasks_feature_id_idx" ON "tasks"("feature_id");

-- CreateIndex
CREATE INDEX "tasks_phase_id_idx" ON "tasks"("phase_id");

-- CreateIndex
CREATE INDEX "tasks_system_assignee_type_idx" ON "tasks"("system_assignee_type");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
