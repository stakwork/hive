-- AlterTable
ALTER TABLE "llm_models" ADD COLUMN     "is_plan_default" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_task_default" BOOLEAN NOT NULL DEFAULT false;
