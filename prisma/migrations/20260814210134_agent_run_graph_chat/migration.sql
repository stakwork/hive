-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "agent_kind" TEXT NOT NULL DEFAULT 'workflow_explorer',
ADD COLUMN     "prompt" TEXT,
ADD COLUMN     "proposals_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reflection" JSONB,
ADD COLUMN     "result" TEXT,
ADD COLUMN     "session_id" TEXT,
ADD COLUMN     "workspace_id" TEXT,
ADD COLUMN     "workspace_slug" TEXT,
ALTER COLUMN "org_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "agent_runs_workspace_id_session_id_idx" ON "agent_runs"("workspace_id", "session_id");
