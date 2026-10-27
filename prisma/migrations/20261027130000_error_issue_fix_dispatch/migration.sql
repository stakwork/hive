-- CreateEnum
CREATE TYPE "ErrorFixStatus" AS ENUM ('DISPATCHING', 'IN_PROGRESS', 'PR_OPENED', 'FAILED');

-- AlterTable
ALTER TABLE "error_issues" ADD COLUMN "fix_status" "ErrorFixStatus",
ADD COLUMN "fix_job_id" TEXT,
ADD COLUMN "fix_pr_url" TEXT,
ADD COLUMN "fix_dispatched_at" TIMESTAMP(3),
ADD COLUMN "fix_dispatched_by_id" TEXT;
