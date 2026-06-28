-- CreateEnum
CREATE TYPE "PromptSyncStatus" AS ENUM ('OK', 'PENDING', 'FAILED');

-- AlterTable
ALTER TABLE "stakwork_runs" ADD COLUMN     "hive_prompt_version_id" TEXT;

-- CreateTable
CREATE TABLE "prompts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "workspace_id" TEXT NOT NULL,
    "published_version_id" TEXT,
    "stakwork_id" INTEGER,
    "sync_status" "PromptSyncStatus" NOT NULL DEFAULT 'OK',
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "whodunnit" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompts_workspace_id_idx" ON "prompts"("workspace_id");

-- CreateIndex
CREATE INDEX "prompts_sync_status_idx" ON "prompts"("sync_status");

-- CreateIndex
CREATE UNIQUE INDEX "prompts_workspace_id_name_key" ON "prompts"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "prompt_versions_prompt_id_idx" ON "prompt_versions"("prompt_id");

-- CreateIndex
CREATE INDEX "prompt_versions_prompt_id_published_idx" ON "prompt_versions"("prompt_id", "published");

-- CreateIndex
CREATE INDEX "stakwork_runs_hive_prompt_version_id_idx" ON "stakwork_runs"("hive_prompt_version_id");

-- AddForeignKey
ALTER TABLE "stakwork_runs" ADD CONSTRAINT "stakwork_runs_hive_prompt_version_id_fkey" FOREIGN KEY ("hive_prompt_version_id") REFERENCES "prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
