-- AlterTable
ALTER TABLE "janitor_configs" ADD COLUMN     "pr_ci_failure_fix_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pr_conflict_fix_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pr_monitor_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pr_out_of_date_fix_enabled" BOOLEAN NOT NULL DEFAULT false;
