-- CreateTable
CREATE TABLE "shared_conversations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT,
    "messages" JSONB NOT NULL,
    "provenance_data" JSONB,
    "follow_up_questions" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shared_conversations_workspace_id_idx" ON "shared_conversations"("workspace_id");

-- CreateIndex
CREATE INDEX "shared_conversations_user_id_idx" ON "shared_conversations"("user_id");

-- AddForeignKey
ALTER TABLE "shared_conversations" ADD CONSTRAINT "shared_conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_conversations" ADD CONSTRAINT "shared_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
