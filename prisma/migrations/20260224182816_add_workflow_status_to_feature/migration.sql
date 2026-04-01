-- AlterTable
ALTER TABLE "features"
ADD COLUMN IF NOT EXISTS "workflow_completed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "workflow_started_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "workflow_status" "WorkflowStatus" DEFAULT 'PENDING';
