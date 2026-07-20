-- AlterTable
ALTER TABLE "agent_logs" ALTER COLUMN "repos" SET DEFAULT ARRAY[]::TEXT[];
