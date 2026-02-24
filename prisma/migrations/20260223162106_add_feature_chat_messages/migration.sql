-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "feature_id" TEXT;

-- CreateIndex
CREATE INDEX "chat_messages_feature_id_idx" ON "chat_messages"("feature_id");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;
