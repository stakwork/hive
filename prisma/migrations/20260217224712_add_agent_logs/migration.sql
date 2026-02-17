-- CreateTable
CREATE TABLE "agent_logs" (
    "id" TEXT NOT NULL,
    "blob_url" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "stakwork_run_id" TEXT,
    "task_id" TEXT,
    "workspace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_logs_stakwork_run_id_idx" ON "agent_logs"("stakwork_run_id");

-- CreateIndex
CREATE INDEX "agent_logs_task_id_idx" ON "agent_logs"("task_id");

-- CreateIndex
CREATE INDEX "agent_logs_workspace_id_idx" ON "agent_logs"("workspace_id");

-- CreateIndex
CREATE INDEX "agent_logs_created_at_idx" ON "agent_logs"("created_at");

-- AddForeignKey
ALTER TABLE "agent_logs" ADD CONSTRAINT "agent_logs_stakwork_run_id_fkey" FOREIGN KEY ("stakwork_run_id") REFERENCES "stakwork_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_logs" ADD CONSTRAINT "agent_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_logs" ADD CONSTRAINT "agent_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
