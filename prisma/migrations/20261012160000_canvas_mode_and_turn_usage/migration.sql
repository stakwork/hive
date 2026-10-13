-- AlterTable
ALTER TABLE "shared_conversations" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'full';

-- CreateTable
CREATE TABLE "canvas_turn_usage" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "turn_id" TEXT,
    "mode" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canvas_turn_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "canvas_turn_usage_conversation_id_created_at_idx" ON "canvas_turn_usage"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "canvas_turn_usage_mode_created_at_idx" ON "canvas_turn_usage"("mode", "created_at");

-- AddForeignKey
ALTER TABLE "canvas_turn_usage" ADD CONSTRAINT "canvas_turn_usage_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "shared_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
