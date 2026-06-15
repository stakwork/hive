-- AlterTable
ALTER TABLE "agent_logs" ADD COLUMN     "config" JSONB,
ADD COLUMN     "session_id" TEXT;
