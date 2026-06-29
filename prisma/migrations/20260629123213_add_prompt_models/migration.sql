-- CreateEnum
CREATE TYPE "PromptSyncStatus" AS ENUM ('OK', 'PENDING', 'FAILED');

-- CreateTable
CREATE TABLE "prompts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
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
CREATE UNIQUE INDEX "prompts_name_key" ON "prompts"("name");

-- CreateIndex
CREATE INDEX "prompts_sync_status_idx" ON "prompts"("sync_status");

-- CreateIndex
CREATE INDEX "prompt_versions_prompt_id_idx" ON "prompt_versions"("prompt_id");

-- CreateIndex
CREATE INDEX "prompt_versions_prompt_id_published_idx" ON "prompt_versions"("prompt_id", "published");

-- AddForeignKey
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
