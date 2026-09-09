-- AlterTable
ALTER TABLE "shared_conversations" ADD COLUMN     "archived_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "shared_conversations_source_control_org_id_user_id_source_a_idx" ON "shared_conversations"("source_control_org_id", "user_id", "source", "archived_at", "last_message_at");
