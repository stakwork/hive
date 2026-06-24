-- AlterTable
ALTER TABLE "agent_logs" ADD COLUMN     "phoenix_trace_url" TEXT,
ADD COLUMN     "trace_id" TEXT,
ADD COLUMN     "trace_status" TEXT;
