-- CreateTable
CREATE TABLE "workflow_summaries" (
    "id" TEXT NOT NULL,
    "workflow_id" INTEGER NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "version_ids" JSONB NOT NULL,
    "content" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_summaries_workspace_id_idx" ON "workflow_summaries"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_summaries_workflow_id_cache_key_key" ON "workflow_summaries"("workflow_id", "cache_key");

-- AddForeignKey
ALTER TABLE "workflow_summaries" ADD CONSTRAINT "workflow_summaries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
