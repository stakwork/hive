-- AlterTable
ALTER TABLE "janitor_configs" ADD COLUMN     "stale_pr_task_threshold_days" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "stale_pr_tasks_enabled" BOOLEAN NOT NULL DEFAULT false;
