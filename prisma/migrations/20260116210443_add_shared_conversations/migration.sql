-- CreateTable
CREATE TABLE "shared_conversations" (
    "id" TEXT NOT NULL,
    "share_code" TEXT NOT NULL,
    "title" TEXT,
    "workspace_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shared_conversations_share_code_key" ON "shared_conversations"("share_code");

-- CreateIndex
CREATE INDEX "shared_conversations_share_code_idx" ON "shared_conversations"("share_code");

-- CreateIndex
CREATE INDEX "shared_conversations_workspace_id_idx" ON "shared_conversations"("workspace_id");

-- CreateIndex
CREATE INDEX "shared_conversations_created_by_id_idx" ON "shared_conversations"("created_by_id");

-- CreateIndex
CREATE INDEX "shared_conversations_created_at_idx" ON "shared_conversations"("created_at");

-- AddForeignKey
ALTER TABLE "shared_conversations" ADD CONSTRAINT "shared_conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_conversations" ADD CONSTRAINT "shared_conversations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
