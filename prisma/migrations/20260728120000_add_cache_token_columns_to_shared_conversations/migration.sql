-- AlterTable
ALTER TABLE "shared_conversations" ADD COLUMN     "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cache_write_tokens" INTEGER NOT NULL DEFAULT 0;
