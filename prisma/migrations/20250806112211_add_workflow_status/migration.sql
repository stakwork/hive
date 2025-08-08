-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'ERROR', 'HALTED', 'FAILED');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "workflow_completed_at" TIMESTAMP(3),
ADD COLUMN     "workflow_started_at" TIMESTAMP(3),
ADD COLUMN     "workflow_status" "WorkflowStatus" DEFAULT 'PENDING';
