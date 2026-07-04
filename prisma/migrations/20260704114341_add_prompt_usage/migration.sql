-- CreateTable
CREATE TABLE "prompt_usages" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "prompt_id" TEXT,
    "prompt_name" TEXT NOT NULL,
    "workflow_id" INTEGER NOT NULL,
    "workflow_name" TEXT,
    "step_id" TEXT NOT NULL,
    "step_unique_id" TEXT,
    "field_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_usages_prompt_name_idx" ON "prompt_usages"("prompt_name");

-- CreateIndex
CREATE INDEX "prompt_usages_prompt_id_idx" ON "prompt_usages"("prompt_id");

-- CreateIndex
CREATE INDEX "prompt_usages_workspace_id_idx" ON "prompt_usages"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_usages_workspace_id_workflow_id_step_id_prompt_name_key" ON "prompt_usages"("workspace_id", "workflow_id", "step_id", "prompt_name");

-- AddForeignKey
ALTER TABLE "prompt_usages" ADD CONSTRAINT "prompt_usages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_usages" ADD CONSTRAINT "prompt_usages_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
