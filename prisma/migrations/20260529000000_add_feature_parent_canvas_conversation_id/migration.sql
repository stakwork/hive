-- AlterTable
ALTER TABLE "features" ADD COLUMN "parent_canvas_conversation_id" TEXT;

-- CreateIndex
CREATE INDEX "features_parent_canvas_conversation_id_idx" ON "features"("parent_canvas_conversation_id");
