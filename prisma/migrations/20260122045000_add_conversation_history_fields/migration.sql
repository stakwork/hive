-- AlterTable
ALTER TABLE "shared_conversations" ADD COLUMN     "is_shared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_message_at" TIMESTAMP(3),
ADD COLUMN     "source" TEXT;

-- CreateIndex
CREATE INDEX "shared_conversations_user_id_workspace_id_last_message_at_idx" ON "shared_conversations"("user_id", "workspace_id", "last_message_at");
