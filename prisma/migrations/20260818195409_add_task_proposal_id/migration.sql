-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "proposal_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tasks_workspace_id_proposal_id_key" ON "tasks"("workspace_id", "proposal_id");
