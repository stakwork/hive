-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StakworkRunType" ADD VALUE 'PLAN_CHAT';
ALTER TYPE "StakworkRunType" ADD VALUE 'WORKFLOW_EDITOR';

-- AlterTable
ALTER TABLE "stakwork_runs" ADD COLUMN     "task_id" TEXT;

-- CreateIndex
CREATE INDEX "stakwork_runs_task_id_idx" ON "stakwork_runs"("task_id");

-- AddForeignKey
ALTER TABLE "stakwork_runs" ADD CONSTRAINT "stakwork_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
