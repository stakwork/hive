-- CreateEnum
CREATE TYPE "SystemAssigneeType" AS ENUM ('TASK_COORDINATOR', 'BOUNTY_HUNTER');

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "system_assignee_type" "SystemAssigneeType";

-- CreateIndex
CREATE INDEX "tickets_system_assignee_type_idx" ON "tickets"("system_assignee_type");
