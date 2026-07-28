-- AddColumn cache_read_input_tokens to shared_conversations
ALTER TABLE "shared_conversations" ADD COLUMN "cache_read_input_tokens" INTEGER NOT NULL DEFAULT 0;

-- AddColumn cache_write_input_tokens to shared_conversations
ALTER TABLE "shared_conversations" ADD COLUMN "cache_write_input_tokens" INTEGER NOT NULL DEFAULT 0;
