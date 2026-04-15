-- AlterTable
ALTER TABLE "agent_logs" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "started_at" TIMESTAMP(3),
ADD COLUMN     "stats" JSONB;
