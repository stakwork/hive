-- CreateEnum
CREATE TYPE "WorkflowTaskType" AS ENUM ('SKILL', 'WORKFLOW', 'SCRIPT', 'PROMPT');

-- AlterTable
ALTER TABLE "workflow_tasks" ADD COLUMN     "workflow_task_type" "WorkflowTaskType";
