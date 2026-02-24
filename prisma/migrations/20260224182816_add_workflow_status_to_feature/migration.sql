-- AlterTable
ALTER TABLE "features" ADD COLUMN     "workflow_completed_at" TIMESTAMP(3),
ADD COLUMN     "workflow_started_at" TIMESTAMP(3),
ADD COLUMN     "workflow_status" "WorkflowStatus" DEFAULT 'PENDING';
